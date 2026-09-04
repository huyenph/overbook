import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { KafkaService, type OutgoingMessage } from '../kafka/kafka.service';
import {
  HEADER_ATTEMPTS,
  HEADER_EVENT_TYPE,
  HEADER_MESSAGE_ID,
  HEADER_TRACE_ID,
} from '../kafka/kafka.constants';
import { MetricsService } from '../metrics/metrics.service';
import { OutboxMessageEntity } from './entities/outbox-message.entity';

/**
 * Q60, the relay half of the outbox.
 *
 * Two properties matter here:
 *
 * 1. `FOR UPDATE SKIP LOCKED` — every API replica can run its own relay
 *    without coordination. Each poll grabs a disjoint set of rows and skips
 *    whatever a sibling already holds. This is the answer to the Milestone 8
 *    trap of "a background job that now runs three times"; no leader election,
 *    no Redis lock, just a queue query the database already knows how to do.
 *
 * 2. Publish-then-mark inside the transaction — if the process dies after the
 *    Kafka write but before COMMIT, the rows stay `pending` and get published
 *    again on restart. That is at-least-once, deliberately: duplicates are
 *    cheap to defend against downstream (`processed_messages`), lost events
 *    are not.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly kafka: KafkaService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('outbox.relayEnabled')) {
      this.logger.warn('outbox relay disabled (OUTBOX_RELAY_ENABLED=false)');
      return;
    }
    this.schedule(0);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const interval = this.config.get<number>('outbox.pollIntervalMs') ?? 1000;
    try {
      const published = await this.drainOnce();
      // Keep draining without waiting while there is a visible backlog.
      this.schedule(published > 0 ? 0 : interval);
    } catch (error) {
      this.logger.error(`relay tick failed: ${(error as Error).message}`);
      this.schedule(interval);
    }
  }

  /** Publishes at most one batch. Returns how many rows went out. */
  async drainOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const endTimer = this.metrics.outboxRelayDurationSeconds.startTimer();

    try {
      const batchSize = this.config.get<number>('outbox.batchSize') ?? 100;
      const maxAttempts = this.config.get<number>('outbox.maxAttempts') ?? 10;

      return await this.dataSource.transaction(async (manager) => {
        const rows = await manager
          .createQueryBuilder(OutboxMessageEntity, 'outbox')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('outbox.status = :status', { status: 'pending' })
          .andWhere('outbox.available_at <= now()')
          .orderBy('outbox.created_at', 'ASC')
          .limit(batchSize)
          .getMany();

        if (rows.length === 0) {
          await this.refreshPendingGauge(manager);
          return 0;
        }

        const messages: OutgoingMessage[] = rows.map((row) => ({
          topic: row.topic,
          key: row.messageKey,
          value: row.payload,
          headers: {
            [HEADER_MESSAGE_ID]: row.id,
            [HEADER_EVENT_TYPE]: row.eventType,
            [HEADER_TRACE_ID]: String((row.payload as { traceId?: string }).traceId ?? ''),
            [HEADER_ATTEMPTS]: '0',
          },
        }));

        try {
          await this.kafka.publishBatch(messages);
        } catch (error) {
          await this.markFailed(manager, rows, maxAttempts, error as Error);
          return 0;
        }

        await manager
          .createQueryBuilder()
          .update(OutboxMessageEntity)
          .set({ status: 'published', publishedAt: () => 'now()', lastError: null })
          .whereInIds(rows.map((row) => row.id))
          .execute();

        for (const row of rows) {
          this.metrics.outboxPublishedTotal.inc({ topic: row.topic });
        }
        await this.refreshPendingGauge(manager);
        return rows.length;
      });
    } finally {
      endTimer();
      this.running = false;
    }
  }

  private async markFailed(
    manager: import('typeorm').EntityManager,
    rows: OutboxMessageEntity[],
    maxAttempts: number,
    error: Error,
  ): Promise<void> {
    this.logger.error(`publish of ${rows.length} outbox rows failed: ${error.message}`);

    for (const row of rows) {
      const attempts = row.attempts + 1;
      // Exponential backoff with a ceiling — a broker outage should not turn
      // into a hot loop against a broker that is already struggling.
      const backoffMs = Math.min(2 ** attempts * 250, 60_000);
      this.metrics.outboxPublishFailuresTotal.inc({ topic: row.topic });

      await manager.getRepository(OutboxMessageEntity).update(
        { id: row.id },
        {
          attempts,
          status: attempts >= maxAttempts ? 'failed' : 'pending',
          availableAt: new Date(Date.now() + backoffMs),
          lastError: error.message.slice(0, 1000),
        },
      );
    }
  }

  private async refreshPendingGauge(manager: import('typeorm').EntityManager): Promise<void> {
    const pending = await manager
      .getRepository(OutboxMessageEntity)
      .count({ where: { status: 'pending' } });
    this.metrics.outboxPendingMessages.set(pending);
  }
}

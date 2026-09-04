import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Consumer, EachMessagePayload } from 'kafkajs';
import { Semaphore } from '../common/concurrency/semaphore';
import {
  HEADER_ATTEMPTS,
  HEADER_ERROR,
  HEADER_EVENT_TYPE,
  HEADER_MESSAGE_ID,
  HEADER_ORIGINAL_TOPIC,
  HEADER_RETRY_AT,
  HEADER_TRACE_ID,
} from '../kafka/kafka.constants';
import { KafkaService } from '../kafka/kafka.service';
import { MetricsService } from '../metrics/metrics.service';
import { NotificationsService } from './notifications.service';
import { computeBackoffMs, shouldDeadLetter } from './retry-policy';

const HEARTBEAT_INTERVAL_MS = 3000;

/**
 * Milestone 6 — the consumer side, with the three failure defences wired
 * together:
 *
 *   retry topic  a failed message is republished to booking.events.retry with
 *                its attempt count and a retry-at stamp, so the main topic is
 *                never head-of-line blocked by one bad message
 *   DLQ          once the attempts are spent the message goes to
 *                booking.events.dlq with the error attached, instead of being
 *                silently dropped or retried forever
 *   backpressure a semaphore caps in-flight work, so a producer that outruns
 *                the worker makes the queue grow (visible, measurable) rather
 *                than the process's heap
 *
 * Kafka has no native delayed delivery, so the retry consumer waits out the
 * remaining delay in-handler while heartbeating. That deliberately blocks its
 * partition — which is the behaviour you want from a delay queue, and the
 * reason the retry topic is separate from the main one.
 */
@Injectable()
export class NotificationsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsConsumer.name);
  private readonly consumers: Consumer[] = [];
  private semaphore!: Semaphore;
  private stopping = false;

  constructor(
    private readonly kafka: KafkaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly metrics: MetricsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get<boolean>('kafka.consumerEnabled')) {
      this.logger.warn('notification consumer disabled (CONSUMER_ENABLED=false)');
      return;
    }

    const concurrency = this.config.get<number>('notifications.concurrency') ?? 10;
    this.semaphore = new Semaphore(concurrency);

    const group = this.config.get<string>('kafka.consumerGroup')!;
    const topics = this.config.get<Record<string, string>>('kafka.topics')!;

    await this.start(group, topics.booking, false);
    await this.start(`${group}-retry`, topics.retry, true);
    this.logger.log(`notification consumer running (concurrency=${concurrency})`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    // Disconnecting commits offsets and leaves the group cleanly, so a rebalance
    // does not have to wait for the session timeout to expire.
    await Promise.all(
      this.consumers.map((consumer) => consumer.disconnect().catch(() => undefined)),
    );
  }

  private async start(groupId: string, topic: string, isRetryTopic: boolean): Promise<void> {
    const consumer = this.kafka.kafka.consumer({
      groupId,
      sessionTimeout: 45000,
      heartbeatInterval: 3000,
    });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });

    await consumer.run({
      // One in-flight batch per partition; the semaphore is what actually bounds
      // total concurrent work across partitions.
      partitionsConsumedConcurrently: 3,
      eachMessage: (payload) => this.onMessage(payload, isRetryTopic),
    });

    this.consumers.push(consumer);
  }

  private async onMessage(payload: EachMessagePayload, isRetryTopic: boolean): Promise<void> {
    const { topic, message } = payload;
    if (this.stopping) return;

    this.metrics.kafkaMessagesConsumedTotal.inc({ topic });

    const header = (name: string): string | undefined => {
      const value = message.headers?.[name];
      return value ? value.toString() : undefined;
    };

    const messageId = header(HEADER_MESSAGE_ID) ?? `${topic}-${message.offset}`;
    const eventType = header(HEADER_EVENT_TYPE) ?? 'unknown';
    const traceId = header(HEADER_TRACE_ID) || undefined;
    const attempts = Number(header(HEADER_ATTEMPTS) ?? '0');
    const body = message.value?.toString() ?? '{}';

    if (isRetryTopic) {
      // Wrapped rather than passed by reference: kafkajs binds heartbeat to the
      // batch it came from, and detaching it loses that binding.
      await this.waitUntilDue(Number(header(HEADER_RETRY_AT) ?? '0'), () => payload.heartbeat());
      if (this.stopping) return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      // Unparseable payloads can never succeed. Straight to the DLQ; retrying
      // them would burn attempts for nothing.
      await this.deadLetter(topic, message.key, body, attempts, 'payload is not valid JSON');
      return;
    }

    this.metrics.notificationInFlight.set(this.semaphore.inFlight);

    await this.semaphore.run(async () => {
      this.metrics.notificationInFlight.set(this.semaphore.inFlight);
      try {
        await this.notifications.handle({ messageId, eventType, traceId, payload: parsed });
      } catch (error) {
        await this.scheduleRetryOrDeadLetter(
          topic,
          message.key,
          body,
          messageId,
          eventType,
          traceId,
          attempts,
          error as Error,
        );
      } finally {
        this.metrics.notificationInFlight.set(this.semaphore.inFlight - 1);
      }
    });
  }

  /** Sleeps until `retryAt`, heartbeating so the broker does not evict us. */
  private async waitUntilDue(retryAtMs: number, heartbeat: () => Promise<void>): Promise<void> {
    while (!this.stopping) {
      const remaining = retryAtMs - Date.now();
      if (remaining <= 0) return;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(remaining, HEARTBEAT_INTERVAL_MS)),
      );
      await heartbeat().catch(() => undefined);
    }
  }

  private async scheduleRetryOrDeadLetter(
    topic: string,
    key: Buffer | null,
    body: string,
    messageId: string,
    eventType: string,
    traceId: string | undefined,
    previousAttempts: number,
    error: Error,
  ): Promise<void> {
    const attempts = previousAttempts + 1;
    const maxAttempts = this.config.get<number>('notifications.maxAttempts') ?? 3;

    if (shouldDeadLetter(attempts, maxAttempts)) {
      await this.deadLetter(topic, key, body, attempts, error.message);
      return;
    }

    const backoffMs = computeBackoffMs(
      attempts,
      this.config.get<number>('notifications.retryBaseMs') ?? 500,
      this.config.get<number>('notifications.retryMaxMs') ?? 30000,
    );

    await this.kafka.publish({
      topic: this.config.get<string>('kafka.topics.retry')!,
      key: key?.toString() ?? messageId,
      value: JSON.parse(body) as Record<string, unknown>,
      headers: {
        [HEADER_MESSAGE_ID]: messageId,
        [HEADER_EVENT_TYPE]: eventType,
        [HEADER_TRACE_ID]: traceId ?? '',
        [HEADER_ATTEMPTS]: String(attempts),
        [HEADER_RETRY_AT]: String(Date.now() + backoffMs),
        [HEADER_ORIGINAL_TOPIC]: topic,
        [HEADER_ERROR]: error.message.slice(0, 500),
      },
    });

    this.metrics.notificationsProcessedTotal.inc({ result: 'retried' });
    this.logger.warn(
      `retry ${attempts}/${maxAttempts} for ${messageId} in ${backoffMs}ms: ${error.message}`,
    );
  }

  private async deadLetter(
    topic: string,
    key: Buffer | null,
    body: string,
    attempts: number,
    reason: string,
  ): Promise<void> {
    await this.kafka
      .publish({
        topic: this.config.get<string>('kafka.topics.dlq')!,
        key: key?.toString() ?? 'unknown',
        value: { raw: body, reason, attempts, deadLetteredAt: new Date().toISOString() },
        headers: {
          [HEADER_ORIGINAL_TOPIC]: topic,
          [HEADER_ATTEMPTS]: String(attempts),
          [HEADER_ERROR]: reason.slice(0, 500),
        },
      })
      .catch((error: Error) =>
        this.logger.error(`could not write to the DLQ, message is at risk: ${error.message}`),
      );

    this.metrics.notificationsProcessedTotal.inc({ result: 'dead_lettered' });
    this.logger.error(`dead-lettered after ${attempts} attempts: ${reason}`);
  }
}

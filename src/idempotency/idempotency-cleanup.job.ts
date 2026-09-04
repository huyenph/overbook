import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { IdempotencyKeyEntity } from './entities/idempotency-key.entity';

const LOCK_KEY = 'cron:idempotency-cleanup';
const LOCK_TTL_MS = 60_000;

/**
 * The Milestone 8 trap, in miniature: scale the api to three replicas and this
 * cron now fires three times a minute instead of once.
 *
 * For a DELETE that is idempotent anyway the damage is small, but the same
 * shape applied to "charge every overdue invoice" is a real incident. The fix
 * is the general one: a short-lived Redis lease decides which replica actually
 * runs the tick, and the others no-op.
 */
@Injectable()
export class IdempotencyCleanupJob {
  private readonly logger = new Logger(IdempotencyCleanupJob.name);

  constructor(
    @InjectRepository(IdempotencyKeyEntity)
    private readonly keys: Repository<IdempotencyKeyEntity>,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepExpiredKeys(): Promise<void> {
    await this.redis.withLock(LOCK_KEY, LOCK_TTL_MS, async () => {
      const result = await this.keys.delete({ expiresAt: LessThan(new Date()) });
      if (result.affected) {
        this.logger.log(`swept ${result.affected} expired idempotency keys`);
      }
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service';
import { ttlWithJitter } from './cache-ttl';
import { RedisService } from './redis.service';

interface CacheEnvelope<T> {
  /** Cached payload. */
  v: T;
  /** Epoch ms after which the entry is stale but still servable. */
  freshUntil: number;
}

export interface CacheOptions {
  /** Metric label, e.g. `event`. */
  name: string;
  ttlSeconds?: number;
}

const SLEEP = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cache-aside (Q22) with the three stampede defences from Q59 layered on top:
 *
 *   1. TTL jitter          — keys do not all expire at the same instant
 *   2. Single flight       — only the lock winner queries the database
 *   3. Stale-while-revalidate — everyone else is served slightly old data
 *                               instead of queueing on the database
 *
 * Set CACHE_STAMPEDE_PROTECTION=false to strip 2 and 3 back out and watch the
 * thundering herd hit Postgres in Grafana (Milestone 4).
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  get enabled(): boolean {
    return this.config.get<boolean>('cache.enabled') ?? true;
  }

  async getOrLoad<T>(key: string, options: CacheOptions, load: () => Promise<T>): Promise<T> {
    const { name } = options;
    if (!this.enabled) {
      this.metrics.cacheRequestsTotal.inc({ cache: name, result: 'disabled' });
      return load();
    }

    const entry = await this.read<T>(key);
    const now = Date.now();

    if (entry && now < entry.freshUntil) {
      this.metrics.cacheRequestsTotal.inc({ cache: name, result: 'hit' });
      return entry.v;
    }

    const protection = this.config.get<boolean>('cache.stampedeProtection') ?? true;

    if (entry) {
      // Stale but usable. One request refreshes in the background; the rest are
      // served immediately and never touch the database.
      this.metrics.cacheRequestsTotal.inc({ cache: name, result: 'stale' });
      if (protection) {
        void this.refreshInBackground(key, options, load);
        return entry.v;
      }
    } else {
      this.metrics.cacheRequestsTotal.inc({ cache: name, result: 'miss' });
    }

    if (!protection) {
      const value = await load();
      await this.write(key, value, options);
      return value;
    }

    return this.singleFlight(key, options, load);
  }

  /** Only the lock winner loads; the losers wait briefly for the winner's write. */
  private async singleFlight<T>(
    key: string,
    options: CacheOptions,
    load: () => Promise<T>,
  ): Promise<T> {
    const lockTtlMs = this.config.get<number>('cache.lockTtlMs') ?? 5000;
    const lockKey = `lock:${key}`;
    const token = await this.redis.acquireLock(lockKey, lockTtlMs);

    if (token) {
      try {
        const value = await load();
        await this.write(key, value, options);
        return value;
      } finally {
        await this.redis.releaseLock(lockKey, token);
      }
    }

    this.metrics.cacheSingleFlightWaitsTotal.inc({ cache: options.name });

    const deadline = Date.now() + Math.min(lockTtlMs, 2000);
    while (Date.now() < deadline) {
      await SLEEP(20);
      const entry = await this.read<T>(key);
      if (entry) return entry.v;
    }

    // The winner died or is unusually slow. Falling back to a direct load keeps
    // the request correct; it just gives up the stampede protection for this one.
    this.logger.warn(`single-flight timeout for ${key}, loading directly`);
    return load();
  }

  private async refreshInBackground<T>(
    key: string,
    options: CacheOptions,
    load: () => Promise<T>,
  ): Promise<void> {
    const lockTtlMs = this.config.get<number>('cache.lockTtlMs') ?? 5000;
    await this.redis
      .withLock(`lock:${key}`, lockTtlMs, async () => {
        const value = await load();
        await this.write(key, value, options);
      })
      .catch((error: Error) => this.logger.warn(`background refresh failed: ${error.message}`));
  }

  private async read<T>(key: string): Promise<CacheEnvelope<T> | null> {
    try {
      const raw = await this.redis.client.get(key);
      return raw ? (JSON.parse(raw) as CacheEnvelope<T>) : null;
    } catch (error) {
      // A cache is an optimisation: if Redis is unhappy, fall through to the DB
      // rather than failing the request.
      this.logger.warn(`cache read failed for ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  private async write<T>(key: string, value: T, options: CacheOptions): Promise<void> {
    const base = options.ttlSeconds ?? this.config.get<number>('cache.ttlSeconds') ?? 30;
    const jitter = this.config.get<number>('cache.ttlJitterSeconds') ?? 0;
    const staleSeconds = this.config.get<number>('cache.staleSeconds') ?? 0;
    const freshSeconds = ttlWithJitter(base, jitter);

    const envelope: CacheEnvelope<T> = { v: value, freshUntil: Date.now() + freshSeconds * 1000 };
    // Redis holds the entry past its freshness window so it can still be served
    // stale while one request refreshes it.
    const redisTtl = freshSeconds + staleSeconds;

    try {
      await this.redis.client.set(key, JSON.stringify(envelope), 'EX', redisTtl);
    } catch (error) {
      this.logger.warn(`cache write failed for ${key}: ${(error as Error).message}`);
    }
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.client.del(key).catch(() => 0);
  }
}

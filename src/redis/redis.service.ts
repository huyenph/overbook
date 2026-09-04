import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

/** Release only if we still own the lock — never delete someone else's lock. */
const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Q26 / Q50 — token bucket, evaluated atomically inside Redis.
 * Atomicity is the whole point: three API replicas share one bucket, so the
 * limit is a system-wide limit, not a per-instance one.
 */
const TOKEN_BUCKET_LUA = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts     = tonumber(bucket[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, math.ceil((capacity / refill) * 1000) + 1000)

local retry_after_ms = 0
if allowed == 0 then
  retry_after_ms = math.ceil(((cost - tokens) / refill) * 1000)
end

return { allowed, math.floor(tokens), retry_after_ms }
`;

export interface TokenBucketResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis({
      host: config.get<string>('redis.host'),
      port: config.get<number>('redis.port'),
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });
    this.client.on('error', (error: Error) => this.logger.warn(`redis error: ${error.message}`));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.client.defineCommand('releaseLock', { numberOfKeys: 1, lua: RELEASE_LOCK_LUA });
    this.client.defineCommand('tokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  /**
   * Q33 — a distributed lock is a lease, not a mutex: it must expire on its own
   * so a crashed holder cannot wedge the system forever.
   */
  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    await (this.client as unknown as { releaseLock(k: string, t: string): Promise<number> })
      .releaseLock(key, token)
      .catch(() => 0);
  }

  /** Runs `fn` only if this instance won the lock; otherwise resolves to null. */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const token = await this.acquireLock(key, ttlMs);
    if (!token) return null;
    try {
      return await fn();
    } finally {
      await this.releaseLock(key, token);
    }
  }

  async consumeToken(
    key: string,
    capacity: number,
    refillPerSecond: number,
    cost = 1,
  ): Promise<TokenBucketResult> {
    const [allowed, remaining, retryAfterMs] = await (
      this.client as unknown as {
        tokenBucket(
          key: string,
          capacity: string,
          refill: string,
          now: string,
          cost: string,
        ): Promise<[number, number, number]>;
      }
    ).tokenBucket(key, String(capacity), String(refillPerSecond), String(Date.now()), String(cost));

    return { allowed: allowed === 1, remaining, retryAfterMs };
  }
}

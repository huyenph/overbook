import { hostname } from 'node:os';

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const float = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

export type BookingLockStrategy = 'none' | 'pessimistic' | 'optimistic';

const lockStrategy = (value: string | undefined): BookingLockStrategy => {
  const normalized = (value ?? 'pessimistic').toLowerCase();
  if (normalized === 'none' || normalized === 'pessimistic' || normalized === 'optimistic') {
    return normalized;
  }
  throw new Error(
    `BOOKING_LOCK_STRATEGY must be one of none|pessimistic|optimistic, got "${value}"`,
  );
};

export const configuration = () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: int(process.env.PORT, 3000),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    // Every metric and log line carries this so a 3-replica run stays readable (M8).
    instanceId: process.env.INSTANCE_ID || hostname(),
    shutdownDrainMs: int(process.env.SHUTDOWN_DRAIN_MS, 5000),
  },
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: int(process.env.DB_PORT, 5432),
    username: process.env.DB_USERNAME ?? 'overbook',
    password: process.env.DB_PASSWORD ?? 'overbook',
    name: process.env.DB_NAME ?? 'overbook',
    // Q58: the pool ceiling is usually the real limit before query time is.
    poolMax: int(process.env.DB_POOL_MAX, 10),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: int(process.env.REDIS_PORT, 6379),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((b) => b.trim()),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'overbook',
    consumerGroup: process.env.KAFKA_CONSUMER_GROUP ?? 'overbook-notifications',
    topics: {
      booking: process.env.KAFKA_TOPIC_BOOKING ?? 'booking.events',
      retry: process.env.KAFKA_TOPIC_RETRY ?? 'booking.events.retry',
      dlq: process.env.KAFKA_TOPIC_DLQ ?? 'booking.events.dlq',
    },
    consumerEnabled: bool(process.env.CONSUMER_ENABLED, true),
  },
  booking: {
    lockStrategy: lockStrategy(process.env.BOOKING_LOCK_STRATEGY),
    optimisticMaxRetries: int(process.env.BOOKING_OPTIMISTIC_MAX_RETRIES, 5),
  },
  cache: {
    enabled: bool(process.env.CACHE_ENABLED, true),
    ttlSeconds: int(process.env.CACHE_TTL_SECONDS, 30),
    ttlJitterSeconds: int(process.env.CACHE_TTL_JITTER_SECONDS, 10),
    stampedeProtection: bool(process.env.CACHE_STAMPEDE_PROTECTION, true),
    lockTtlMs: int(process.env.CACHE_LOCK_TTL_MS, 5000),
    staleSeconds: int(process.env.CACHE_STALE_SECONDS, 60),
  },
  outbox: {
    enabled: bool(process.env.OUTBOX_ENABLED, true),
    relayEnabled: bool(process.env.OUTBOX_RELAY_ENABLED, true),
    pollIntervalMs: int(process.env.OUTBOX_POLL_INTERVAL_MS, 1000),
    batchSize: int(process.env.OUTBOX_BATCH_SIZE, 100),
    maxAttempts: int(process.env.OUTBOX_MAX_ATTEMPTS, 10),
    directPublishMode: bool(process.env.DIRECT_PUBLISH_MODE, false),
    crashAfterCommit: bool(process.env.FAULT_CRASH_AFTER_BOOKING_COMMIT, false),
  },
  notifications: {
    failureRate: float(process.env.NOTIFICATION_FAILURE_RATE, 0),
    maxAttempts: int(process.env.NOTIFICATION_MAX_ATTEMPTS, 3),
    retryBaseMs: int(process.env.NOTIFICATION_RETRY_BASE_MS, 500),
    retryMaxMs: int(process.env.NOTIFICATION_RETRY_MAX_MS, 30000),
    concurrency: int(process.env.NOTIFICATION_CONCURRENCY, 10),
  },
  rateLimit: {
    enabled: bool(process.env.RATE_LIMIT_ENABLED, true),
    capacity: int(process.env.RATE_LIMIT_CAPACITY, 20),
    refillPerSecond: float(process.env.RATE_LIMIT_REFILL_PER_SECOND, 10),
  },
});

export type AppConfiguration = ReturnType<typeof configuration>;

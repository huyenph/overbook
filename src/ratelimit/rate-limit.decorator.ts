import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'overbook:rate-limit';

export interface RateLimitOptions {
  /** Namespace for the Redis key, e.g. `booking`. */
  bucket: string;
  /** Burst size. Defaults to RATE_LIMIT_CAPACITY. */
  capacity?: number;
  /** Sustained rate. Defaults to RATE_LIMIT_REFILL_PER_SECOND. */
  refillPerSecond?: number;
}

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

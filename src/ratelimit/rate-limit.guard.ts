import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { HttpMetricsInterceptor } from '../metrics/http-metrics.interceptor';
import { MetricsService } from '../metrics/metrics.service';
import { RedisService } from '../redis/redis.service';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';

/**
 * Q26 / Q50 — a *distributed* rate limiter.
 *
 * The counter lives in Redis, not in process memory, so three API replicas
 * behind nginx enforce one shared budget. An in-memory limiter would silently
 * let 3x the configured traffic through the moment you scale out — that is the
 * bug this design avoids, and it is what Milestone 7 asks you to prove.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.get<boolean>('rateLimit.enabled')) return true;

    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const route = HttpMetricsInterceptor.routeOf(request);

    const capacity = options.capacity ?? this.config.get<number>('rateLimit.capacity') ?? 20;
    const refill =
      options.refillPerSecond ?? this.config.get<number>('rateLimit.refillPerSecond') ?? 10;
    const bucketKey = `ratelimit:${options.bucket}:${this.identify(request)}`;

    let decision;
    try {
      decision = await this.redis.consumeToken(bucketKey, capacity, refill);
    } catch (error) {
      // Fail open. A limiter that takes the whole API down when Redis blips is
      // a worse outage than the traffic it was protecting against.
      this.logger.error(`rate limiter unavailable, allowing request: ${(error as Error).message}`);
      return true;
    }

    response.setHeader('RateLimit-Limit', String(capacity));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, decision.remaining)));

    if (decision.allowed) {
      this.metrics.rateLimitDecisionsTotal.inc({ result: 'allowed', route });
      return true;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    response.setHeader('Retry-After', String(retryAfterSeconds));
    this.metrics.rateLimitDecisionsTotal.inc({ result: 'blocked', route });

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
        retryAfterMs: decision.retryAfterMs,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Identity for the bucket. `user-id` first so one aggressive user cannot burn
   * the budget of everyone else behind the same NAT; the forwarded IP is the
   * fallback for anonymous traffic.
   */
  private identify(request: Request): string {
    const userId = (request.body as { userId?: string } | undefined)?.userId;
    if (userId) return `user:${userId}`;
    const forwarded = request.header('x-forwarded-for')?.split(',')[0]?.trim();
    return `ip:${forwarded ?? request.ip ?? 'unknown'}`;
  }
}

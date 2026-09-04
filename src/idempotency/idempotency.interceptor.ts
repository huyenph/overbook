import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { Repository } from 'typeorm';
import { requestFingerprint } from './request-fingerprint';
import { IdempotencyKeyEntity } from './entities/idempotency-key.entity';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const TTL_HOURS = 24;

/**
 * Q29 / Q64.
 *
 * The claim is made *before* the handler runs, with an INSERT that relies on
 * the primary key to break the tie. That is what makes it safe under real
 * concurrency: two simultaneous retries of one click cannot both get past the
 * insert, because Postgres will only let one of them create the row.
 *
 *   first request  -> row inserted as in_progress -> handler runs -> response stored
 *   later retry    -> row found completed         -> stored response replayed
 *   parallel retry -> row found in_progress       -> 409, tell the client to retry
 *   same key, different body -> 422, the key is being reused for a new intent
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @InjectRepository(IdempotencyKeyEntity)
    private readonly keys: Repository<IdempotencyKeyEntity>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const key = request.header(IDEMPOTENCY_HEADER)?.trim();
    if (!key) {
      // No key means the client accepted the risk of duplicates.
      return next.handle();
    }

    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;
    const fingerprint = requestFingerprint(request.method, request.originalUrl, request.body);

    return from(this.claim(key, endpoint, fingerprint)).pipe(
      switchMap((claim) => {
        if (claim.kind === 'replay') {
          response.status(claim.status);
          response.setHeader('Idempotent-Replay', 'true');
          return of(claim.body);
        }

        return next.handle().pipe(
          tap({
            next: (body) => {
              void this.complete(key, response.statusCode, body);
            },
            error: () => {
              // Failures are not cached: the client should be able to retry the
              // same key once the transient cause is gone.
              void this.release(key);
            },
          }),
        );
      }),
    );
  }

  private async claim(
    key: string,
    endpoint: string,
    fingerprint: string,
  ): Promise<{ kind: 'proceed' } | { kind: 'replay'; status: number; body: unknown }> {
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);

    const inserted = await this.keys
      .createQueryBuilder()
      .insert()
      .into(IdempotencyKeyEntity)
      .values({
        key,
        endpoint,
        requestHash: fingerprint,
        status: 'in_progress',
        expiresAt,
      })
      .orIgnore()
      // RETURNING is explicit: with ON CONFLICT DO NOTHING an empty result set
      // is exactly how Postgres reports "somebody else already claimed it".
      .returning('key')
      .execute();

    if ((inserted.raw as unknown[]).length > 0) {
      return { kind: 'proceed' };
    }

    const existing = await this.keys.findOne({ where: { key } });
    if (!existing) {
      // The row expired and was swept between the insert and the read.
      return { kind: 'proceed' };
    }

    if (existing.requestHash !== fingerprint) {
      throw new UnprocessableEntityException(
        'This Idempotency-Key was already used with a different request body',
      );
    }

    if (existing.status === 'completed' && existing.responseStatus !== null) {
      return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
    }

    throw new ConflictException(
      'A request with this Idempotency-Key is still in progress, retry shortly',
    );
  }

  private async complete(key: string, status: number, body: unknown): Promise<void> {
    await this.keys
      .update({ key }, { status: 'completed', responseStatus: status, responseBody: body })
      .catch((error: Error) =>
        this.logger.error(`failed to persist idempotent response for ${key}: ${error.message}`),
      );
  }

  private async release(key: string): Promise<void> {
    await this.keys.delete({ key }).catch(() => undefined);
  }
}

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type IdempotencyStatus = 'in_progress' | 'completed';

/**
 * Q64 — the idempotency table, exactly as an interview answer describes it:
 * key, request fingerprint, stored response, expiry.
 *
 * `in_progress` is inserted first, inside its own transaction, so two
 * concurrent retries of the same key cannot both proceed: the second insert
 * hits the primary key and is told to wait/replay instead.
 */
@Entity('idempotency_keys')
export class IdempotencyKeyEntity {
  @PrimaryColumn({ type: 'varchar', length: 200 })
  key!: string;

  @Column({ type: 'varchar', length: 200 })
  endpoint!: string;

  @Column({ type: 'char', length: 64, name: 'request_hash' })
  requestHash!: string;

  @Column({ type: 'varchar', length: 20, default: 'in_progress' })
  status!: IdempotencyStatus;

  @Column({ type: 'int', name: 'response_status', nullable: true })
  responseStatus!: number | null;

  @Column({ type: 'jsonb', name: 'response_body', nullable: true })
  // `any` rather than `unknown`: TypeORM's QueryDeepPartialEntity walks the
  // property type recursively and cannot express an opaque jsonb blob.
  responseBody!: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Index()
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;
}

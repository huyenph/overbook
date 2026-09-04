import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type OutboxStatus = 'pending' | 'published' | 'failed';

/**
 * Q60 — the outbox row is written in the SAME transaction as the booking.
 * Either both land or neither does, so a crash between "committed" and
 * "published" can no longer lose the event: the relay picks it up afterwards.
 */
@Entity('outbox_messages')
@Index(['status', 'availableAt'])
export class OutboxMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, name: 'aggregate_type' })
  aggregateType!: string;

  @Column({ type: 'varchar', length: 100, name: 'aggregate_id' })
  aggregateId!: string;

  @Column({ type: 'varchar', length: 100, name: 'event_type' })
  eventType!: string;

  @Column({ type: 'varchar', length: 200 })
  topic!: string;

  /** Kafka partition key — same key means same partition means ordering per aggregate. */
  @Column({ type: 'varchar', length: 200, name: 'message_key' })
  messageKey!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: OutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  /** Backoff marker: the relay ignores rows until this instant has passed. */
  @Column({ type: 'timestamptz', name: 'available_at', default: () => 'now()' })
  availableAt!: Date;

  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}

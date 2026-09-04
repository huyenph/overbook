import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Consumer-side dedup table. Kafka gives at-least-once delivery; recording the
 * message id here (inside the same transaction as the side effect) is what
 * turns that into effectively-exactly-once processing.
 */
@Entity('processed_messages')
export class ProcessedMessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 200, name: 'message_id' })
  messageId!: string;

  @PrimaryColumn({ type: 'varchar', length: 200, name: 'consumer_group' })
  consumerGroup!: string;

  @Column({ type: 'varchar', length: 100, name: 'event_type' })
  eventType!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'processed_at' })
  processedAt!: Date;
}

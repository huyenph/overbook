import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EventEntity } from '../../events/entities/event.entity';

export type BookingStatus = 'confirmed' | 'cancelled';

@Entity('bookings')
@Index(['eventId', 'createdAt'])
export class BookingEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid', name: 'event_id' })
  eventId!: string;

  @ManyToOne(() => EventEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event?: EventEntity;

  @ApiProperty()
  @Index()
  @Column({ type: 'varchar', length: 100, name: 'user_id' })
  userId!: string;

  @ApiProperty()
  @Column({ type: 'int' })
  quantity!: number;

  @ApiProperty({ enum: ['confirmed', 'cancelled'] })
  @Column({ type: 'varchar', length: 20, default: 'confirmed' })
  status!: BookingStatus;

  @ApiProperty({ required: false, description: 'Idempotency-Key the booking was created under.' })
  @Column({ type: 'varchar', length: 200, name: 'idempotency_key', nullable: true })
  idempotencyKey!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

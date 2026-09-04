import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A sellable event (a concert, a match). `availableSeats` is the contended
 * resource that Milestone 1 oversells on purpose.
 *
 * Every timestamp is `timestamptz` and every process runs with TZ=UTC, so the
 * value stored is an absolute instant, never a wall clock in someone's zone.
 */
@Entity('events')
export class EventEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty()
  @Index()
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  venue!: string;

  @ApiProperty()
  @Column({ type: 'int', name: 'total_seats' })
  totalSeats!: number;

  @ApiProperty({ description: 'Decremented under a lock; must never go below zero.' })
  @Column({ type: 'int', name: 'available_seats' })
  availableSeats!: number;

  @ApiProperty({ description: 'Price per seat, in the smallest currency unit.' })
  @Column({ type: 'int', name: 'price_cents' })
  priceCents!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  /**
   * Hand-managed optimistic lock counter (Q57). Not TypeORM's @VersionColumn:
   * the bump is written explicitly in the UPDATE so the compare-and-set is
   * visible in the code being studied.
   */
  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

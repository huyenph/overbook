import { ApiProperty } from '@nestjs/swagger';
import type { BookingEntity } from '../entities/booking.entity';

export class BookingResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ enum: ['confirmed', 'cancelled'] }) status!: string;
  @ApiProperty({ description: 'Seats left after this booking committed.' })
  seatsRemaining!: number;
  @ApiProperty({ description: 'Lock strategy that served this request (M1).' })
  lockStrategy!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;

  static from(
    booking: BookingEntity,
    seatsRemaining: number,
    strategy: string,
  ): BookingResponseDto {
    return {
      id: booking.id,
      eventId: booking.eventId,
      userId: booking.userId,
      quantity: booking.quantity,
      status: booking.status,
      seatsRemaining,
      lockStrategy: strategy,
      createdAt: new Date(booking.createdAt).toISOString(),
    };
  }
}

export class SeatIntegrityDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty() totalSeats!: number;
  @ApiProperty({ description: 'What the counter column currently says.' })
  availableSeats!: number;
  @ApiProperty({ description: 'Seats actually sold, summed from the bookings table.' })
  confirmedSeats!: number;
  @ApiProperty({ description: 'confirmedSeats - totalSeats. Anything above 0 is the M1 bug.' })
  oversoldBy!: number;
  @ApiProperty({ description: 'True when the counter and the bookings table disagree.' })
  counterDrift!: boolean;
}

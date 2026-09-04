import { ApiProperty } from '@nestjs/swagger';
import type { EventEntity } from '../entities/event.entity';

export class EventResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() venue!: string;
  @ApiProperty() totalSeats!: number;
  @ApiProperty() availableSeats!: number;
  @ApiProperty() priceCents!: number;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;

  static from(event: EventEntity): EventResponseDto {
    return {
      id: event.id,
      name: event.name,
      venue: event.venue,
      totalSeats: event.totalSeats,
      availableSeats: event.availableSeats,
      priceCents: event.priceCents,
      // Always serialised as a UTC instant, regardless of the container's clock.
      startsAt: new Date(event.startsAt).toISOString(),
      version: event.version,
      createdAt: new Date(event.createdAt).toISOString(),
    };
  }
}

export class EventPageDto {
  @ApiProperty({ type: [EventResponseDto] }) items!: EventResponseDto[];
  @ApiProperty({ nullable: true, description: 'Pass back as ?cursor= to fetch the next page.' })
  nextCursor!: string | null;
}

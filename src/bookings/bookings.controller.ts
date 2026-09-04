import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { IDEMPOTENCY_HEADER, IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { RateLimit } from '../ratelimit/rate-limit.decorator';
import { RateLimitGuard } from '../ratelimit/rate-limit.guard';
import { BookingsService } from './bookings.service';
import { BookingResponseDto, SeatIntegrityDto } from './dto/booking-response.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingEntity } from './entities/booking.entity';

@ApiTags('bookings')
@Controller({ version: '1' })
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('events/:eventId/bookings')
  @UseGuards(RateLimitGuard)
  @RateLimit({ bucket: 'booking' })
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Book seats',
    description:
      'Milestones 1, 2, 5 and 7 all meet here: the seat decrement is protected by ' +
      'BOOKING_LOCK_STRATEGY, retries are collapsed by Idempotency-Key, the ' +
      'confirmation event is written to the outbox in the same transaction, and the ' +
      'endpoint sits behind the Redis token bucket.',
  })
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: false,
    description: 'Send the same key on a retry and the original response is replayed.',
  })
  @ApiCreatedResponse({ type: BookingResponseDto })
  @ApiConflictResponse({ description: 'Sold out, or a retry with this key is still in flight.' })
  @ApiUnprocessableEntityResponse({ description: 'Idempotency-Key reused with a different body.' })
  @ApiTooManyRequestsResponse({ description: 'Token bucket exhausted.' })
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateBookingDto,
    @Req() request: Request & { traceId?: string },
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<BookingResponseDto> {
    return this.bookings.book(eventId, dto, {
      traceId: request.traceId,
      idempotencyKey: idempotencyKey?.trim(),
    });
  }

  @Get('events/:eventId/integrity')
  @ApiOperation({
    summary: 'Seat integrity report — the Milestone 1 acceptance check',
    description:
      'Compares the seat counter against the sum of the bookings table. ' +
      'oversoldBy must be 0; anything else means the lock did not hold.',
  })
  @ApiOkResponse({ type: SeatIntegrityDto })
  integrity(@Param('eventId', ParseUUIDPipe) eventId: string): Promise<SeatIntegrityDto> {
    return this.bookings.integrity(eventId);
  }

  @Get('events/:eventId/bookings')
  @ApiOperation({ summary: 'Recent bookings for an event' })
  listByEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('limit') limit?: string,
  ): Promise<BookingEntity[]> {
    return this.bookings.listByEvent(eventId, Math.min(Number(limit) || 50, 200));
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'Read one booking' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<BookingEntity> {
    return this.bookings.findOne(id);
  }
}

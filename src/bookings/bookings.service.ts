import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { EventEntity } from '../events/entities/event.entity';
import { EventsService } from '../events/events.service';
import { KafkaService } from '../kafka/kafka.service';
import { HEADER_EVENT_TYPE, HEADER_MESSAGE_ID, HEADER_TRACE_ID } from '../kafka/kafka.constants';
import { MetricsService } from '../metrics/metrics.service';
import { OutboxService } from '../outbox/outbox.service';
import type { BookingLockStrategy } from '../config/configuration';
import { BookingResponseDto, SeatIntegrityDto } from './dto/booking-response.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingEntity } from './entities/booking.entity';

export const BOOKING_CONFIRMED = 'booking.confirmed';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(BookingEntity) private readonly bookings: Repository<BookingEntity>,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly outbox: OutboxService,
    private readonly kafka: KafkaService,
    private readonly events: EventsService,
  ) {}

  get strategy(): BookingLockStrategy {
    return this.config.get<BookingLockStrategy>('booking.lockStrategy') ?? 'pessimistic';
  }

  /**
   * The whole point of Milestone 1 lives here.
   *
   * Booking = read the seat counter, decide, decrement, insert a booking row,
   * and (Milestone 5) write the outbox row — all inside one transaction.
   * How the decrement is made safe is switchable at runtime so the same load
   * test can produce the bug and then prove the fix:
   *
   *   none        read-modify-write with no protection. Two requests read the
   *               same "1 seat left" and both sell it. This is the bug.
   *   pessimistic SELECT ... FOR UPDATE. The row is locked on read, so the
   *               second request blocks until the first commits (Q57 — the
   *               right default for a flash sale, where conflict is the norm).
   *   optimistic  UPDATE ... WHERE version = :seen. Nobody blocks; a loser
   *               sees 0 rows affected and retries (Q57 — better when
   *               conflicts are rare, wasteful when they are constant).
   */
  async book(
    eventId: string,
    dto: CreateBookingDto,
    context: { traceId?: string; idempotencyKey?: string } = {},
  ): Promise<BookingResponseDto> {
    const strategy = this.strategy;
    const endLockTimer = this.metrics.bookingLockWaitSeconds.startTimer({ strategy });

    try {
      const { booking, seatsRemaining, eventName } = await this.dataSource.transaction(
        async (manager) => {
          const result =
            strategy === 'pessimistic'
              ? await this.decrementPessimistic(manager, eventId, dto.quantity)
              : strategy === 'optimistic'
                ? await this.decrementOptimistic(manager, eventId, dto.quantity)
                : await this.decrementNaive(manager, eventId, dto.quantity);

          const booking = await manager.getRepository(BookingEntity).save(
            manager.getRepository(BookingEntity).create({
              eventId,
              userId: dto.userId,
              quantity: dto.quantity,
              status: 'confirmed',
              idempotencyKey: context.idempotencyKey ?? null,
            }),
          );

          // Same transaction, same commit. If this rolls back, so does the seat
          // decrement and the booking row — there is no window where the
          // booking exists but the event does not.
          if (this.config.get<boolean>('outbox.enabled') && !this.directPublishMode) {
            await this.outbox.enqueue(manager, {
              aggregateType: 'booking',
              aggregateId: booking.id,
              eventType: BOOKING_CONFIRMED,
              topic: this.config.get<string>('kafka.topics.booking')!,
              // Partition by event: all bookings for one event stay ordered.
              messageKey: eventId,
              payload: {
                bookingId: booking.id,
                eventId,
                userId: booking.userId,
                quantity: booking.quantity,
                eventName: result.eventName,
                bookedAt: booking.createdAt.toISOString(),
                traceId: context.traceId ?? null,
              },
            });
          }

          return { booking, seatsRemaining: result.seatsRemaining, eventName: result.eventName };
        },
      );

      endLockTimer();
      this.metrics.bookingsTotal.inc({ result: 'confirmed', strategy });

      // The cached event still advertises the old seat count (M3/M4).
      await this.events.invalidateCache(eventId);

      if (strategy === 'none') {
        await this.recordOversoldIfAny(eventId);
      }

      // Milestone 5, step 2: crash in the gap between COMMIT and PUBLISH.
      // With DIRECT_PUBLISH_MODE=true the event is lost forever. With the
      // outbox enabled it is merely late — the relay picks it up on restart.
      if (this.config.get<boolean>('outbox.crashAfterCommit')) {
        this.logger.error(
          `FAULT INJECTION: killing the process after committing booking ${booking.id}`,
        );
        setImmediate(() => process.exit(137));
      }

      if (this.directPublishMode) {
        await this.publishDirectly(booking, eventName, context.traceId);
      }

      return BookingResponseDto.from(booking, seatsRemaining, strategy);
    } catch (error) {
      endLockTimer();
      const result = error instanceof ConflictException ? 'sold_out' : 'error';
      this.metrics.bookingsTotal.inc({ result, strategy });
      throw error;
    }
  }

  private get directPublishMode(): boolean {
    return this.config.get<boolean>('outbox.directPublishMode') ?? false;
  }

  // ---------- Milestone 1: the three strategies ----------

  /** BROKEN ON PURPOSE. Read, decide, write — with a real gap in between. */
  private async decrementNaive(
    manager: EntityManager,
    eventId: string,
    quantity: number,
  ): Promise<{ seatsRemaining: number; eventName: string }> {
    const event = await manager.getRepository(EventEntity).findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.availableSeats < quantity) {
      throw new ConflictException('Sold out');
    }

    // Read Committed does not protect this: every concurrent transaction read
    // the same snapshot before any of them wrote.
    const remaining = event.availableSeats - quantity;
    await manager
      .getRepository(EventEntity)
      .update({ id: eventId }, { availableSeats: remaining });

    return { seatsRemaining: remaining, eventName: event.name };
  }

  /** Q57 pessimistic: lock the row on read, everyone else queues. */
  private async decrementPessimistic(
    manager: EntityManager,
    eventId: string,
    quantity: number,
  ): Promise<{ seatsRemaining: number; eventName: string }> {
    const event = await manager.getRepository(EventEntity).findOne({
      where: { id: eventId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.availableSeats < quantity) {
      throw new ConflictException('Sold out');
    }

    const remaining = event.availableSeats - quantity;
    await manager
      .getRepository(EventEntity)
      .update({ id: eventId }, { availableSeats: remaining, version: () => 'version + 1' } as never);

    return { seatsRemaining: remaining, eventName: event.name };
  }

  /** Q57 optimistic: no lock, compare-and-set on `version`, retry on a miss. */
  private async decrementOptimistic(
    manager: EntityManager,
    eventId: string,
    quantity: number,
  ): Promise<{ seatsRemaining: number; eventName: string }> {
    const maxRetries = this.config.get<number>('booking.optimisticMaxRetries') ?? 5;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const event = await manager.getRepository(EventEntity).findOne({ where: { id: eventId } });
      if (!event) throw new NotFoundException(`Event ${eventId} not found`);
      if (event.availableSeats < quantity) {
        throw new ConflictException('Sold out');
      }

      const result = await manager
        .createQueryBuilder()
        .update(EventEntity)
        .set({
          availableSeats: () => `available_seats - ${quantity}`,
          version: () => 'version + 1',
        })
        .where('id = :id AND version = :version AND available_seats >= :quantity', {
          id: eventId,
          version: event.version,
          quantity,
        })
        .execute();

      if (result.affected === 1) {
        return { seatsRemaining: event.availableSeats - quantity, eventName: event.name };
      }
      // Somebody else won the race: re-read and try again.
    }

    // Under sustained contention optimistic locking degrades into this — which
    // is exactly why a flash sale wants the pessimistic lock instead.
    throw new ConflictException('Too much contention on this event, please retry');
  }

  // ---------- Verification ----------

  /**
   * Ground truth for "did we oversell?": the sum of the bookings table, not the
   * counter column. The counter is the thing that can lie.
   */
  async integrity(eventId: string): Promise<SeatIntegrityDto> {
    const event = await this.dataSource
      .getRepository(EventEntity)
      .findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const { sum } = await this.bookings
      .createQueryBuilder('booking')
      .select('COALESCE(SUM(booking.quantity), 0)', 'sum')
      .where('booking.event_id = :eventId AND booking.status = :status', {
        eventId,
        status: 'confirmed',
      })
      .getRawOne<{ sum: string }>()!;

    const confirmedSeats = Number(sum ?? 0);
    return {
      eventId,
      totalSeats: event.totalSeats,
      availableSeats: event.availableSeats,
      confirmedSeats,
      oversoldBy: Math.max(0, confirmedSeats - event.totalSeats),
      counterDrift: event.availableSeats !== event.totalSeats - confirmedSeats,
    };
  }

  private async recordOversoldIfAny(eventId: string): Promise<void> {
    const report = await this.integrity(eventId);
    if (report.oversoldBy > 0) {
      this.metrics.bookingsOversoldTotal.inc({ event_id: eventId }, 1);
    }
  }

  async findOne(id: string): Promise<BookingEntity> {
    const booking = await this.bookings.findOne({ where: { id } });
    if (!booking) throw new NotFoundException(`Booking ${id} not found`);
    return booking;
  }

  async listByEvent(eventId: string, limit = 50): Promise<BookingEntity[]> {
    return this.bookings.find({
      where: { eventId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** The naive dual write, kept for contrast with the outbox path. */
  private async publishDirectly(
    booking: BookingEntity,
    eventName: string,
    traceId?: string,
  ): Promise<void> {
    await this.kafka
      .publish({
        topic: this.config.get<string>('kafka.topics.booking')!,
        key: booking.eventId,
        value: {
          bookingId: booking.id,
          eventId: booking.eventId,
          userId: booking.userId,
          quantity: booking.quantity,
          eventName,
          bookedAt: booking.createdAt.toISOString(),
          traceId: traceId ?? null,
        },
        headers: {
          [HEADER_MESSAGE_ID]: booking.id,
          [HEADER_EVENT_TYPE]: BOOKING_CONFIRMED,
          [HEADER_TRACE_ID]: traceId ?? '',
        },
      })
      .catch((error: Error) => {
        // And this is the failure mode the outbox exists to remove: the booking
        // is already committed, the event is gone, and nothing records the gap.
        this.logger.error(`direct publish lost the event for ${booking.id}: ${error.message}`);
      });
  }
}

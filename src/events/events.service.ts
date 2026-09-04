import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from '../redis/cache.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventPageDto, EventResponseDto } from './dto/event-response.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { EventEntity } from './entities/event.entity';

export const eventCacheKey = (id: string): string => `cache:event:${id}`;

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(EventEntity) private readonly events: Repository<EventEntity>,
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateEventDto): Promise<EventResponseDto> {
    const event = this.events.create({
      name: dto.name,
      venue: dto.venue,
      totalSeats: dto.totalSeats,
      availableSeats: dto.totalSeats,
      priceCents: dto.priceCents,
      startsAt: new Date(dto.startsAt),
    });
    const saved = await this.events.save(event);
    return EventResponseDto.from(saved);
  }

  /** M3/M4 — the read-heavy endpoint. Cache-aside sits entirely in CacheService. */
  async findOne(id: string): Promise<EventResponseDto> {
    const cached = await this.cache.getOrLoad<EventResponseDto | null>(
      eventCacheKey(id),
      { name: 'event' },
      async () => {
        const event = await this.events.findOne({ where: { id } });
        return event ? EventResponseDto.from(event) : null;
      },
    );

    // Negative results are cached too, so a flood of requests for a bogus id
    // cannot be used to bypass the cache and hammer Postgres.
    if (!cached) throw new NotFoundException(`Event ${id} not found`);
    return cached;
  }

  /** Uncached read straight from Postgres — the M3 "before" measurement. */
  async findOneUncached(id: string): Promise<EventResponseDto> {
    const event = await this.events.findOne({ where: { id } });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return EventResponseDto.from(event);
  }

  async list(query: ListEventsDto): Promise<EventPageDto> {
    const qb = this.events
      .createQueryBuilder('event')
      .orderBy('event.id', 'ASC')
      .limit(query.limit + 1);

    if (query.cursor) {
      qb.where('event.id > :cursor', { cursor: query.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map(EventResponseDto.from),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async invalidateCache(id: string): Promise<void> {
    await this.cache.invalidate(eventCacheKey(id));
  }
}

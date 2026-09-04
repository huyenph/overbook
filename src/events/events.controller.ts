import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateEventDto } from './dto/create-event.dto';
import { EventPageDto, EventResponseDto } from './dto/event-response.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller({ path: 'events', version: '1' })
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an event with a fixed seat inventory' })
  @ApiOkResponse({ type: EventResponseDto })
  create(@Body() dto: CreateEventDto): Promise<EventResponseDto> {
    return this.events.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List events (keyset pagination — Q55)' })
  @ApiOkResponse({ type: EventPageDto })
  list(@Query() query: ListEventsDto): Promise<EventPageDto> {
    return this.events.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one event — served through the Redis cache (M3/M4)' })
  @ApiOkResponse({ type: EventResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<EventResponseDto> {
    return this.events.findOne(id);
  }

  @Get(':id/uncached')
  @ApiOperation({
    summary: 'Read one event bypassing the cache — the M3 "before" baseline for k6',
  })
  @ApiOkResponse({ type: EventResponseDto })
  findOneUncached(@Param('id', ParseUUIDPipe) id: string): Promise<EventResponseDto> {
    return this.events.findOneUncached(id);
  }
}

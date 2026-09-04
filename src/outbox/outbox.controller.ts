import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxMessageEntity } from './entities/outbox-message.entity';
import { OutboxRelay } from './outbox.relay';

@ApiTags('outbox')
@Controller({ path: 'outbox', version: '1' })
export class OutboxController {
  constructor(
    @InjectRepository(OutboxMessageEntity)
    private readonly outbox: Repository<OutboxMessageEntity>,
    private readonly relay: OutboxRelay,
  ) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Outbox backlog by status — the Milestone 5 acceptance check',
    description:
      'After killing the API mid-booking, pending should be > 0 and then drain to 0 ' +
      'once the relay runs. No event is ever lost, only late.',
  })
  async stats(): Promise<{ pending: number; published: number; failed: number; oldestPendingAt: string | null }> {
    const rows = await this.outbox
      .createQueryBuilder('outbox')
      .select('outbox.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MIN(outbox.created_at)', 'oldest')
      .groupBy('outbox.status')
      .getRawMany<{ status: string; count: string; oldest: Date | null }>();

    const byStatus = new Map(rows.map((row) => [row.status, row]));
    const oldestPending = byStatus.get('pending')?.oldest ?? null;

    return {
      pending: Number(byStatus.get('pending')?.count ?? 0),
      published: Number(byStatus.get('published')?.count ?? 0),
      failed: Number(byStatus.get('failed')?.count ?? 0),
      oldestPendingAt: oldestPending ? new Date(oldestPending).toISOString() : null,
    };
  }

  @Post('drain')
  @ApiOperation({ summary: 'Run one relay batch immediately (useful in tests and demos)' })
  async drain(): Promise<{ published: number }> {
    return { published: await this.relay.drainOnce() };
  }
}

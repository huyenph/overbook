import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'How many messages this consumer group has actually processed',
    description:
      'Counts rows in processed_messages. With NOTIFICATION_FAILURE_RATE turned up, ' +
      'this plus the DLQ topic must still account for every message produced — ' +
      'the Milestone 6 acceptance criterion that nothing vanishes silently.',
  })
  stats(): Promise<{ processed: number; consumerGroup: string }> {
    return this.notifications.stats();
  }
}

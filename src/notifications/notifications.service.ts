import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service';
import { ProcessedMessageEntity } from './processed-message.entity';

export interface IncomingNotification {
  messageId: string;
  eventType: string;
  traceId?: string;
  payload: {
    bookingId?: string;
    eventId?: string;
    userId?: string;
    quantity?: number;
    eventName?: string;
  };
}

export class NotificationDeliveryError extends Error {}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(ProcessedMessageEntity)
    private readonly processed: Repository<ProcessedMessageEntity>,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Kafka delivers at least once, and the outbox relay republishes anything it
   * could not confirm. Both are correct; both mean this handler will sometimes
   * see the same message twice.
   *
   * Claiming the message id in `processed_messages` before doing the work is
   * what turns at-least-once *delivery* into exactly-once *effect*: the second
   * copy loses the insert and returns without sending a second email.
   */
  async handle(message: IncomingNotification): Promise<'sent' | 'duplicate'> {
    const consumerGroup = this.config.get<string>('kafka.consumerGroup')!;

    const claim = await this.processed
      .createQueryBuilder()
      .insert()
      .into(ProcessedMessageEntity)
      .values({
        messageId: message.messageId,
        consumerGroup,
        eventType: message.eventType,
      })
      .orIgnore()
      .returning('message_id')
      .execute();

    if ((claim.raw as unknown[]).length === 0) {
      this.metrics.notificationsProcessedTotal.inc({ result: 'duplicate' });
      this.logger.debug(`skipping duplicate delivery of ${message.messageId}`);
      return 'duplicate';
    }

    try {
      await this.deliver(message);
      this.metrics.notificationsProcessedTotal.inc({ result: 'sent' });
      return 'sent';
    } catch (error) {
      // Release the claim: the work did not happen, so a retry must be allowed
      // to happen. Leaving the row behind would turn a transient failure into a
      // permanently skipped notification.
      await this.processed
        .delete({ messageId: message.messageId, consumerGroup })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Stands in for the email provider. NOTIFICATION_FAILURE_RATE is the knob
   * Milestone 6 turns up to 0.3 to watch retries and the DLQ do their job.
   */
  private async deliver(message: IncomingNotification): Promise<void> {
    const failureRate = this.config.get<number>('notifications.failureRate') ?? 0;
    if (failureRate > 0 && Math.random() < failureRate) {
      throw new NotificationDeliveryError(
        `simulated provider failure for booking ${message.payload.bookingId}`,
      );
    }

    this.logger.log(
      `email sent: booking=${message.payload.bookingId} user=${message.payload.userId} ` +
        `event="${message.payload.eventName}" trace=${message.traceId ?? '-'}`,
    );
  }

  async stats(): Promise<{ processed: number; consumerGroup: string }> {
    const consumerGroup = this.config.get<string>('kafka.consumerGroup')!;
    return {
      consumerGroup,
      processed: await this.processed.count({ where: { consumerGroup } }),
    };
  }
}

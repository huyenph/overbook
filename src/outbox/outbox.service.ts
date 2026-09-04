import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { OutboxMessageEntity } from './entities/outbox-message.entity';

export interface EnqueueOutboxInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  topic: string;
  messageKey: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  /**
   * Q60 — note the signature: it takes the caller's `EntityManager`, so the
   * outbox row is written by the *same* transaction as the business row.
   * Passing a fresh repository here would quietly reintroduce the dual-write
   * bug the pattern exists to remove.
   */
  async enqueue(manager: EntityManager, input: EnqueueOutboxInput): Promise<OutboxMessageEntity> {
    const repository = manager.getRepository(OutboxMessageEntity);
    const message = repository.create({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      topic: input.topic,
      messageKey: input.messageKey,
      payload: input.payload,
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
    });
    return repository.save(message);
  }
}

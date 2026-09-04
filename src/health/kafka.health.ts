import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { KafkaService } from '../kafka/kafka.service';

@Injectable()
export class KafkaHealthIndicator {
  constructor(
    private readonly kafka: KafkaService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  isHealthy(key: string) {
    const check = this.indicator.check(key);
    return this.kafka.isConnected ? check.up() : check.down({ message: 'producer not connected' });
  }
}

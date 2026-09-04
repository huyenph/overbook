import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: RedisService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const check = this.indicator.check(key);
    try {
      const pong = await this.redis.ping();
      return pong ? check.up() : check.down({ message: 'PING did not return PONG' });
    } catch (error) {
      return check.down({ message: (error as Error).message });
    }
  }
}

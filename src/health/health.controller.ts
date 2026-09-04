import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { LifecycleService } from '../common/shutdown/lifecycle.service';
import { KafkaHealthIndicator } from './kafka.health';
import { RedisHealthIndicator } from './redis.health';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly kafka: KafkaHealthIndicator,
    private readonly lifecycle: LifecycleService,
  ) {}

  /**
   * Q52 — liveness answers "is this process wedged?" and nothing else.
   *
   * It deliberately does not touch Postgres, Redis or Kafka. If it did, a
   * database blip would make every replica fail liveness at once and the
   * orchestrator would restart the entire fleet — turning a recoverable
   * dependency outage into a full outage.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness — is the process running? No dependencies checked.' })
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: this.lifecycle.uptimeSeconds };
  }

  /**
   * Readiness answers a different question: "should traffic be sent here right
   * now?" An instance that is alive but cannot reach its database is not ready,
   * and neither is one that has started draining for shutdown.
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness — dependencies reachable and not draining.' })
  async ready() {
    if (this.lifecycle.isDraining) {
      throw new ServiceUnavailableException({
        status: 'draining',
        message: 'shutting down, remove this instance from the pool',
      });
    }

    return this.health.check([
      () => this.database.pingCheck('postgres', { timeout: 2000 }),
      () => this.redis.isHealthy('redis'),
      () => this.kafka.isHealthy('kafka'),
    ]);
  }
}

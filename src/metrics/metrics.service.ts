import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * One registry, one place where every metric name is declared.
 *
 * Label discipline matters more than it looks: `route` is the Express route
 * *template* (`/events/:id`), never the raw URL, otherwise every event id
 * would mint a new time series and Prometheus would fall over.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  readonly httpRequestsInFlight: Gauge<string>;

  readonly bookingsTotal: Counter<'result' | 'strategy'>;
  readonly bookingsOversoldTotal: Counter<'event_id'>;
  readonly bookingLockWaitSeconds: Histogram<'strategy'>;

  readonly cacheRequestsTotal: Counter<'cache' | 'result'>;
  readonly cacheSingleFlightWaitsTotal: Counter<'cache'>;

  readonly outboxPendingMessages: Gauge<string>;
  readonly outboxPublishedTotal: Counter<'topic'>;
  readonly outboxPublishFailuresTotal: Counter<'topic'>;
  readonly outboxRelayDurationSeconds: Histogram<string>;

  readonly kafkaMessagesConsumedTotal: Counter<'topic'>;
  readonly notificationsProcessedTotal: Counter<'result'>;
  readonly notificationInFlight: Gauge<string>;

  readonly rateLimitDecisionsTotal: Counter<'result' | 'route'>;

  constructor(config: ConfigService) {
    const instanceId = config.get<string>('app.instanceId') ?? 'unknown';
    this.registry.setDefaultLabels({ instance_id: instanceId });
    collectDefaultMetrics({ register: this.registry });

    const registers = [this.registry];

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status_code'],
      // Tight low buckets: the interesting question is p95 at a few hundred RPS,
      // not whether something took 30s.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers,
    });
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers,
    });
    this.httpRequestsInFlight = new Gauge({
      name: 'http_requests_in_flight',
      help: 'HTTP requests currently being served (drains to 0 on graceful shutdown)',
      registers,
    });

    this.bookingsTotal = new Counter({
      name: 'bookings_total',
      help: 'Booking attempts by outcome',
      labelNames: ['result', 'strategy'],
      registers,
    });
    this.bookingsOversoldTotal = new Counter({
      name: 'bookings_oversold_total',
      help: 'Seats sold beyond capacity — the Milestone 1 bug; must stay at 0 once fixed',
      labelNames: ['event_id'],
      registers,
    });
    this.bookingLockWaitSeconds = new Histogram({
      name: 'booking_lock_wait_seconds',
      help: 'Time spent acquiring the seat lock',
      labelNames: ['strategy'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
      registers,
    });

    this.cacheRequestsTotal = new Counter({
      name: 'cache_requests_total',
      help: 'Cache lookups by outcome (hit / miss / stale)',
      labelNames: ['cache', 'result'],
      registers,
    });
    this.cacheSingleFlightWaitsTotal = new Counter({
      name: 'cache_single_flight_waits_total',
      help: 'Requests that waited for another request to refill the key instead of hitting the DB',
      labelNames: ['cache'],
      registers,
    });

    this.outboxPendingMessages = new Gauge({
      name: 'outbox_pending_messages',
      help: 'Outbox rows still waiting to be published',
      registers,
    });
    this.outboxPublishedTotal = new Counter({
      name: 'outbox_published_total',
      help: 'Outbox rows successfully published to Kafka',
      labelNames: ['topic'],
      registers,
    });
    this.outboxPublishFailuresTotal = new Counter({
      name: 'outbox_publish_failures_total',
      help: 'Outbox publish attempts that failed and will be retried',
      labelNames: ['topic'],
      registers,
    });
    this.outboxRelayDurationSeconds = new Histogram({
      name: 'outbox_relay_duration_seconds',
      help: 'Duration of one outbox relay poll cycle',
      buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5],
      registers,
    });

    this.kafkaMessagesConsumedTotal = new Counter({
      name: 'kafka_messages_consumed_total',
      help: 'Kafka messages consumed',
      labelNames: ['topic'],
      registers,
    });
    this.notificationsProcessedTotal = new Counter({
      name: 'notifications_processed_total',
      help: 'Notification jobs by outcome (sent / retried / dead_lettered / duplicate)',
      labelNames: ['result'],
      registers,
    });
    this.notificationInFlight = new Gauge({
      name: 'notification_in_flight',
      help: 'Notification jobs currently being processed (bounded by NOTIFICATION_CONCURRENCY)',
      registers,
    });

    this.rateLimitDecisionsTotal = new Counter({
      name: 'rate_limit_decisions_total',
      help: 'Rate limiter decisions (allowed / blocked)',
      labelNames: ['result', 'route'],
      registers,
    });
  }

  async scrape(): Promise<string> {
    return this.registry.metrics();
  }
}

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ValidationPipe } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { BookingsModule } from './bookings/bookings.module';
import { CommonModule } from './common/common.module';
import { TraceIdMiddleware } from './common/trace/trace-id.middleware';
import { resolveTraceId } from './common/trace/resolve-trace-id';
import { configuration } from './config/configuration';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { KafkaModule } from './kafka/kafka.module';
import { HttpMetricsInterceptor } from './metrics/http-metrics.interceptor';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OutboxModule } from './outbox/outbox.module';
import { RateLimitModule } from './ratelimit/ratelimit.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('app.logLevel') ?? 'info',
          // Structured JSON in containers; pretty output only when a human is
          // reading it locally (Q65 — logs are data, not decoration).
          transport:
            config.get<string>('app.env') === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:isoDateTime' },
                }
              : undefined,
          genReqId: (req) => resolveTraceId(req.headers),
          customProps: () => ({ instanceId: config.get<string>('app.instanceId') }),
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: {
            // Scrape traffic would otherwise drown out real requests.
            ignore: (req) => req.url === '/metrics' || req.url?.startsWith('/health') === true,
          },
        },
      }),
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        autoLoadEntities: true,
        // Schema changes go through reviewed migrations, always.
        synchronize: false,
        migrationsRun: false,
        namingStrategy: new SnakeNamingStrategy(),
        extra: {
          max: config.get<number>('database.poolMax'),
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
          options: '-c timezone=UTC',
        },
      }),
    }),

    ScheduleModule.forRoot(),

    CommonModule,
    MetricsModule,
    RedisModule,
    KafkaModule,
    HealthModule,
    EventsModule,
    IdempotencyModule,
    RateLimitModule,
    OutboxModule,
    BookingsModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('*');
  }
}

import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const setupSwagger = (app: INestApplication): void => {
  const config = new DocumentBuilder()
    .setTitle('Overbook')
    .setDescription(
      [
        'A flash-sale ticket booking API used as a system design lab.',
        '',
        'Each endpoint exists to make one distributed-systems failure reproducible,',
        'and every fix is switchable at runtime through the environment so the same',
        'load test can show the bug and then show it gone:',
        '',
        '- `BOOKING_LOCK_STRATEGY=none` oversells seats (M1)',
        '- omit `Idempotency-Key` and a retried booking charges twice (M2)',
        '- `CACHE_ENABLED=false` puts every read back on Postgres (M3)',
        '- `CACHE_STAMPEDE_PROTECTION=false` lets the herd through on expiry (M4)',
        '- `DIRECT_PUBLISH_MODE=true` + `FAULT_CRASH_AFTER_BOOKING_COMMIT=true` loses events (M5)',
        '- `NOTIFICATION_FAILURE_RATE=0.3` exercises retries and the DLQ (M6)',
        '- `RATE_LIMIT_ENABLED=false` removes the only bound on write traffic (M7)',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addTag('events', 'Event inventory — the cached read path')
    .addTag('bookings', 'The contended write path')
    .addTag('outbox', 'Transactional outbox backlog')
    .addTag('notifications', 'Consumer-side processing')
    .addTag('health', 'Liveness and readiness')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true },
  });
};

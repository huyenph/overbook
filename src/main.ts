import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { LifecycleService } from './common/shutdown/lifecycle.service';
import { setupSwagger } from './swagger';

// Set before anything reads a clock: the whole system reasons in UTC.
process.env.TZ = 'UTC';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const lifecycle = app.get(LifecycleService);
  const logger = app.get(Logger);

  // Q66 — URI versioning: /v1/... . Adding /v2 later does not break clients
  // still calling /v1, which is the entire point of versioning an API.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.set('trust proxy', 1);
  app.enableCors({ origin: true });
  setupSwagger(app);

  // Nest closes providers on SIGTERM only if hooks are enabled; without this
  // the Kafka consumer would never leave its group cleanly.
  app.enableShutdownHooks();

  const port = config.get<number>('app.port') ?? 3000;
  const drainMs = config.get<number>('app.shutdownDrainMs') ?? 5000;

  /**
   * M8 / Q53 — graceful shutdown, in the order that actually avoids dropped
   * requests:
   *
   *   SIGTERM -> readiness starts failing -> wait for the balancer to notice
   *           -> stop accepting, finish in-flight work -> exit
   *
   * Closing the server immediately on SIGTERM is the common mistake: nginx is
   * still routing to this container for another health-check interval, and
   * every one of those requests becomes a connection reset.
   */
  const shutdown = (signal: string) => {
    void (async () => {
      logger.warn(`${signal} received, draining for ${drainMs}ms before closing`);
      lifecycle.beginDraining();
      await new Promise((resolve) => setTimeout(resolve, drainMs));
      await app.close();
      logger.warn('shutdown complete');
      process.exit(0);
    })();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  await app.listen(port, '0.0.0.0');
  logger.log(
    `overbook listening on ${port} (instance=${config.get<string>('app.instanceId')}, ` +
      `lock=${config.get<string>('booking.lockStrategy')}, docs at /docs)`,
  );
};

void bootstrap();

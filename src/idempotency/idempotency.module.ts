import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKeyEntity } from './entities/idempotency-key.entity';
import { IdempotencyCleanupJob } from './idempotency-cleanup.job';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKeyEntity])],
  providers: [IdempotencyInterceptor, IdempotencyCleanupJob],
  exports: [IdempotencyInterceptor, TypeOrmModule],
})
export class IdempotencyModule {}

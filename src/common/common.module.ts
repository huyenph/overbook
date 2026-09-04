import { Global, Module } from '@nestjs/common';
import { LifecycleService } from './shutdown/lifecycle.service';
import { TraceIdMiddleware } from './trace/trace-id.middleware';

@Global()
@Module({
  providers: [LifecycleService, TraceIdMiddleware],
  exports: [LifecycleService, TraceIdMiddleware],
})
export class CommonModule {}

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const route = HttpMetricsInterceptor.routeOf(request);
    const method = request.method;
    const stopTimer = this.metrics.httpRequestDuration.startTimer({ method, route });

    this.metrics.httpRequestsInFlight.inc();

    const record = () => {
      const statusCode = String(response.statusCode);
      stopTimer({ status_code: statusCode });
      this.metrics.httpRequestsTotal.inc({ method, route, status_code: statusCode });
      this.metrics.httpRequestsInFlight.dec();
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }

  /**
   * Route template, not the concrete URL — `/events/:id`, so cardinality stays
   * bounded no matter how many events exist.
   */
  static routeOf(request: Request): string {
    const path = request.route?.path as string | undefined;
    if (path) return path;
    return request.originalUrl?.split('?')[0] ?? 'unknown';
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { resolveTraceId } from './resolve-trace-id';
import { TRACE_HEADER } from './trace.constants';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const traceId = resolveTraceId(req.headers);
    (req as Request & { traceId: string }).traceId = traceId;
    req.headers[TRACE_HEADER] = traceId;
    res.setHeader(TRACE_HEADER, traceId);
    next();
  }
}

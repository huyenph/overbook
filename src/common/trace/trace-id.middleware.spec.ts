import type { Request, Response } from 'express';
import { TraceIdMiddleware } from './trace-id.middleware';

describe('TraceIdMiddleware', () => {
  const middleware = new TraceIdMiddleware();

  const run = (headers: Record<string, string>) => {
    const req = { headers } as unknown as Request & { traceId: string };
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    const next = jest.fn();
    middleware.use(req, res, next);
    return { req, setHeader, next };
  };

  it('attaches the id to the request, the outbound header and the inbound headers', () => {
    const { req, setHeader, next } = run({ 'x-request-id': 'abc' });
    expect(req.traceId).toBe('abc');
    expect(req.headers['x-request-id']).toBe('abc');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'abc');
    expect(next).toHaveBeenCalled();
  });

  it('always continues the chain, even with no inbound id', () => {
    const { req, next } = run({});
    expect(req.traceId).toHaveLength(36);
    expect(next).toHaveBeenCalled();
  });
});

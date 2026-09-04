import { resolveTraceId } from './resolve-trace-id';

describe('resolveTraceId', () => {
  it('reuses a well-formed inbound id so the trace spans nginx -> api', () => {
    expect(resolveTraceId({ 'x-request-id': 'abc-123' })).toBe('abc-123');
    expect(resolveTraceId({ 'x-trace-id': 'trace:9' })).toBe('trace:9');
  });

  it('generates a fresh id when the header is missing or blank', () => {
    expect(resolveTraceId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveTraceId({ 'x-request-id': '   ' })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses attacker-shaped ids instead of writing them into logs', () => {
    expect(resolveTraceId({ 'x-request-id': 'bad id\nINJECTED' })).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveTraceId({ 'x-request-id': 'x'.repeat(200) })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('takes the first value when a proxy sent the header twice', () => {
    expect(resolveTraceId({ 'x-request-id': ['first', 'second'] })).toBe('first');
  });
});

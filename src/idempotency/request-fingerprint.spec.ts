import { requestFingerprint } from './request-fingerprint';

describe('requestFingerprint', () => {
  it('is stable across key order', () => {
    const a = requestFingerprint('POST', '/v1/events/1/bookings', { userId: 'u1', quantity: 2 });
    const b = requestFingerprint('POST', '/v1/events/1/bookings', { quantity: 2, userId: 'u1' });
    expect(a).toBe(b);
  });

  it('changes when the payload changes', () => {
    const a = requestFingerprint('POST', '/x', { quantity: 1 });
    const b = requestFingerprint('POST', '/x', { quantity: 2 });
    expect(a).not.toBe(b);
  });

  it('changes when the target changes, so one key cannot be replayed elsewhere', () => {
    const a = requestFingerprint('POST', '/v1/events/1/bookings', { userId: 'u1' });
    const b = requestFingerprint('POST', '/v1/events/2/bookings', { userId: 'u1' });
    expect(a).not.toBe(b);
  });

  it('handles nested objects and arrays deterministically', () => {
    const a = requestFingerprint('POST', '/x', { seats: [1, 2], meta: { b: 1, a: 2 } });
    const b = requestFingerprint('POST', '/x', { meta: { a: 2, b: 1 }, seats: [1, 2] });
    expect(a).toBe(b);
  });

  it('produces a 64-char sha256 hex digest, matching the char(64) column', () => {
    expect(requestFingerprint('POST', '/x', {})).toMatch(/^[0-9a-f]{64}$/);
  });
});

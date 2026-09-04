import { ttlWithJitter } from './cache-ttl';

describe('ttlWithJitter', () => {
  it('spreads expiry across [base, base + jitter]', () => {
    expect(ttlWithJitter(30, 10, () => 0)).toBe(30);
    expect(ttlWithJitter(30, 10, () => 0.999)).toBe(40);
  });

  it('is a no-op when jitter is disabled', () => {
    expect(ttlWithJitter(30, 0)).toBe(30);
  });

  it('never returns a TTL below 1s, which redis would treat as no expiry at all', () => {
    expect(ttlWithJitter(0, 0)).toBe(1);
    expect(ttlWithJitter(-5, 0)).toBe(1);
  });
});

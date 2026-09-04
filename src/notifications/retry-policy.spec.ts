import { computeBackoffMs, shouldDeadLetter } from './retry-policy';

describe('computeBackoffMs', () => {
  it('doubles the ceiling on every attempt', () => {
    const top = () => 0.999999;
    expect(computeBackoffMs(1, 500, 30000, top)).toBe(499);
    expect(computeBackoffMs(2, 500, 30000, top)).toBe(999);
    expect(computeBackoffMs(3, 500, 30000, top)).toBe(1999);
  });

  it('clamps at the ceiling so a stuck message does not wait for hours', () => {
    expect(computeBackoffMs(20, 500, 30000, () => 0.999999)).toBe(29999);
  });

  it('spreads retries across the window rather than firing them together', () => {
    expect(computeBackoffMs(3, 500, 30000, () => 0)).toBe(0);
    expect(computeBackoffMs(3, 500, 30000, () => 0.5)).toBe(1000);
  });
});

describe('shouldDeadLetter', () => {
  it('dead-letters only after the configured attempts are used up', () => {
    expect(shouldDeadLetter(2, 3)).toBe(false);
    expect(shouldDeadLetter(3, 3)).toBe(true);
    expect(shouldDeadLetter(4, 3)).toBe(true);
  });
});

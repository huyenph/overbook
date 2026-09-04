import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { createEvent, bookSeat } from './lib/api.js';

/**
 * Milestone 7 — the write endpoint under a burst.
 *
 * One user id, so every request lands in the same Redis token bucket. With the
 * api scaled to three replicas the totals must not change: that is the whole
 * claim of a distributed limiter, and the reason the counter lives in Redis
 * instead of in each process.
 *
 *   docker compose up -d --scale api=3
 *   k6 run load-tests/07-rate-limit.js
 */
const accepted = new Counter('rl_accepted');
const throttled = new Counter('rl_throttled');

export const options = {
  scenarios: {
    burst: { executor: 'per-vu-iterations', vus: 100, iterations: 1, maxDuration: '30s' },
  },
};

export function setup() {
  return { eventId: createEvent(1000000, `ratelimit-${Date.now()}`) };
}

export default function (data) {
  // Same identity for everyone: one bucket, shared across replicas.
  const response = bookSeat(data.eventId, 'burst-user');
  if (response.status === 429) throttled.add(1);
  if (response.status === 201) accepted.add(1);

  check(response, {
    'either served or throttled, never a 5xx': (r) => r.status === 201 || r.status === 429,
    '429 tells the client when to come back': (r) =>
      r.status !== 429 || r.headers['Retry-After'] !== undefined,
  });
}

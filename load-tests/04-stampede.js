import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, createEvent } from './lib/api.js';

/**
 * Milestone 4 — cache stampede.
 *
 * Set a short TTL, put continuous load on one hot key, then delete the key
 * mid-run and watch what reaches Postgres:
 *
 *   CACHE_STAMPEDE_PROTECTION=false -> every in-flight request misses at once
 *                                      and they all query the database together
 *   CACHE_STAMPEDE_PROTECTION=true  -> one request refills, the rest are served
 *                                      stale or wait on the single-flight lock
 *
 * Watch `cache_single_flight_waits_total` and the cache outcome panel while
 * this runs. To force the miss from another terminal:
 *
 *   docker compose exec redis redis-cli --scan --pattern 'cache:event:*' | \
 *     xargs docker compose exec -T redis redis-cli del
 */
export const options = {
  scenarios: {
    hot_key: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RPS || 800),
      timeUnit: '1s',
      duration: __ENV.DURATION || '90s',
      preAllocatedVUs: 300,
      maxVUs: 1000,
    },
  },
};

export function setup() {
  return { eventId: createEvent(1000000, `stampede-${Date.now()}`) };
}

export default function (data) {
  const response = http.get(`${BASE_URL}/v1/events/${data.eventId}`, {
    tags: { name: 'GET /v1/events/:id hot' },
  });
  check(response, { 'served': (r) => r.status === 200 });
}

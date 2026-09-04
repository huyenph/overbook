import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, createEvent } from './lib/api.js';

/**
 * Milestone 3 — the same read, with and without the cache.
 *
 *   k6 run -e MODE=uncached load-tests/03-cache-read.js   # Postgres takes it all
 *   k6 run -e MODE=cached   load-tests/03-cache-read.js   # Redis takes it all
 *
 * Compare p95 between the two runs in Grafana. The number is the lesson; the
 * pattern (Q22 cache-aside) is just how you get it.
 */
export const options = {
  scenarios: {
    hammer: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RPS || 1000),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 200,
      maxVUs: 1000,
    },
  },
  thresholds: { http_req_failed: ['rate<0.05'] },
};

const MODE = __ENV.MODE || 'cached';

export function setup() {
  return { eventId: createEvent(1000000, `cache-${Date.now()}`) };
}

export default function (data) {
  const path = MODE === 'uncached' ? 'uncached' : '';
  const url = `${BASE_URL}/v1/events/${data.eventId}${path ? '/' + path : ''}`;
  const response = http.get(url, { tags: { name: `GET /v1/events/:id ${MODE}` } });
  check(response, { 'read ok': (r) => r.status === 200 });
}

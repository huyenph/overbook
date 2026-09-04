import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, createEvent } from './lib/api.js';

/**
 * Milestone 0 — the baseline measurement.
 *
 * The deliverable of M0 is not a passing test, it is a sentence you can say
 * with numbers behind it: "at 300 RPS this endpoint's p95 is X ms and the
 * bottleneck is Y". Run this, then read the Grafana dashboard.
 */
export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      // Arrival-rate, not VU-based: we are measuring the system's response to a
      // fixed offered load, not how fast N clients can go.
      rate: Number(__ENV.RPS || 300),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 100,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  return { eventId: createEvent(1000000, `baseline-${Date.now()}`) };
}

export default function (data) {
  const response = http.get(`${BASE_URL}/v1/events/${data.eventId}`, {
    tags: { name: 'GET /v1/events/:id' },
  });
  check(response, { 'read ok': (r) => r.status === 200 });
}

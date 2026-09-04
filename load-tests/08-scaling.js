import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, createEvent } from './lib/api.js';

/**
 * Milestone 8 — sustained load while a replica is killed.
 *
 *   docker compose up -d --scale api=3
 *   k6 run load-tests/08-scaling.js
 *   # in another terminal, mid-run:
 *   docker kill -s KILL $(docker ps -q -f name=overbook-lab-api | head -1)
 *
 * Acceptance: no dropped requests. nginx retries the in-flight request against
 * another replica, readiness removes the dead one from rotation, and the
 * per-replica Grafana panel shows traffic redistributing.
 *
 * Then do it again with SIGTERM instead of SIGKILL to see graceful shutdown:
 * that replica should finish its in-flight work and report zero errors.
 */
export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RPS || 200),
      timeUnit: '1s',
      duration: __ENV.DURATION || '120s',
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    // The bar for M8: killing a container mid-run must not cost users requests.
    http_req_failed: ['rate<0.001'],
  },
};

export function setup() {
  return { eventId: createEvent(1000000, `scaling-${Date.now()}`) };
}

export default function (data) {
  const response = http.get(`${BASE_URL}/v1/events/${data.eventId}`, {
    tags: { name: 'GET /v1/events/:id' },
  });
  check(response, { 'served through the outage': (r) => r.status === 200 });
}

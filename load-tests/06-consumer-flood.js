import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { BASE_URL, createEvent, bookSeat } from './lib/api.js';

/**
 * Milestone 6 — flood the pipeline with a failing consumer.
 *
 * Restart the api with NOTIFICATION_FAILURE_RATE=0.3 first, then run this. The
 * acceptance criterion is not "everything succeeds"; it is that every message
 * ends up either processed or in the DLQ, and none silently vanish.
 *
 * Check afterwards:
 *   curl localhost:8080/v1/notifications/stats
 *   curl localhost:8080/v1/outbox/stats
 *   kafka-ui at localhost:8081 -> booking.events.dlq
 */
export const options = {
  scenarios: {
    flood: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RPS || 200),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 100,
      maxVUs: 500,
    },
  },
  thresholds: { http_req_failed: ['rate<0.5'] },
};

export function setup() {
  return { eventId: createEvent(1000000, `flood-${Date.now()}`) };
}

export default function (data) {
  const response = bookSeat(data.eventId, `flood-${exec.vu.idInTest}`);
  check(response, { 'booked or shed': (r) => r.status === 201 || r.status === 429 });
}

export function teardown(data) {
  const outbox = http.get(`${BASE_URL}/v1/outbox/stats`).json();
  const consumer = http.get(`${BASE_URL}/v1/notifications/stats`).json();
  console.log(`\n--- Milestone 6 result ---`);
  console.log(`outbox published : ${outbox.published}`);
  console.log(`outbox pending   : ${outbox.pending}  (should drain to 0)`);
  console.log(`outbox failed    : ${outbox.failed}`);
  console.log(`consumer processed: ${consumer.processed}`);
  console.log(`Anything missing from these totals should be sitting in the DLQ topic.\n`);
}

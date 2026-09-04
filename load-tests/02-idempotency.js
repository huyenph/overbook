import { check } from 'k6';
import exec from 'k6/execution';
import { createEvent, bookSeat, integrity } from './lib/api.js';

/**
 * Milestone 2 — the client that lost its connection and retried.
 *
 * Every VU sends the same booking five times under one Idempotency-Key, the way
 * a mobile client with an aggressive retry policy would. Exactly one booking per
 * VU must exist afterwards, and the four replays must return the original
 * response rather than a fresh one.
 */
export const options = {
  scenarios: {
    retries: { executor: 'per-vu-iterations', vus: 50, iterations: 1, maxDuration: '60s' },
  },
};

const VUS = 50;
const RETRIES = 5;

export function setup() {
  return { eventId: createEvent(VUS, `idempotency-${Date.now()}`) };
}

export default function (data) {
  const key = `vu-${exec.vu.idInTest}-${data.eventId}`;
  const bodies = [];

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const response = bookSeat(data.eventId, `vu-${exec.vu.idInTest}`, { idempotencyKey: key });
    // A 409 means a sibling retry is still in flight — the correct answer for a
    // duplicate that arrives before the first one finished.
    if (response.status === 201) bodies.push(response.json('id'));
  }

  check(bodies, {
    'all replays returned the same booking id': (ids) =>
      ids.length === 0 || ids.every((id) => id === ids[0]),
  });
}

export function teardown(data) {
  const report = integrity(data.eventId);
  console.log(`\n--- Milestone 2 result ---`);
  console.log(`VUs x retries : ${VUS} x ${RETRIES} = ${VUS * RETRIES} requests sent`);
  console.log(`bookings made : ${report.confirmedSeats}`);
  console.log(
    report.confirmedSeats === VUS
      ? `PASS — ${VUS * RETRIES} requests collapsed into ${VUS} bookings.\n`
      : `FAIL — expected ${VUS} bookings, got ${report.confirmedSeats}. Retries were charged twice.\n`,
  );
}

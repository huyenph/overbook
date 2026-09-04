import { check } from 'k6';
import exec from 'k6/execution';
import { createEvent, bookSeat, integrity } from './lib/api.js';

/**
 * Milestone 1 — 200 concurrent requests for 100 seats.
 *
 * Run it twice without touching a line of code:
 *
 *   BOOKING_LOCK_STRATEGY=none        -> oversoldBy > 0, the bug
 *   BOOKING_LOCK_STRATEGY=pessimistic -> exactly 100 sold, the fix
 *
 * The whole point is that the *test* is identical across both runs. Only the
 * lock changed.
 */
export const options = {
  scenarios: {
    // All 200 VUs are released at once, which is what makes the read-modify-write
    // window overlap. A ramping profile would hide the race.
    stampede: { executor: 'per-vu-iterations', vus: 200, iterations: 1, maxDuration: '60s' },
  },
  thresholds: {
    // Sold-out responses are correct behaviour here, not errors.
    checks: ['rate>0.99'],
  },
};

const SEATS = Number(__ENV.SEATS || 100);

export function setup() {
  return { eventId: createEvent(SEATS, `oversell-${Date.now()}`) };
}

export default function (data) {
  const response = bookSeat(data.eventId, `vu-${exec.vu.idInTest}`);
  check(response, {
    'answered with a decision, not a crash': (r) =>
      r.status === 201 || r.status === 409 || r.status === 429,
  });
}

export function teardown(data) {
  const report = integrity(data.eventId);
  console.log(`\n--- Milestone 1 result ---`);
  console.log(`capacity      : ${report.totalSeats}`);
  console.log(`seats sold    : ${report.confirmedSeats}`);
  console.log(`counter says  : ${report.availableSeats} left`);
  console.log(`OVERSOLD BY   : ${report.oversoldBy}`);
  console.log(`counter drift : ${report.counterDrift}`);
  console.log(
    report.oversoldBy === 0 && !report.counterDrift
      ? 'PASS — the lock held.\n'
      : 'FAIL — seats were sold twice. This is the bug the milestone is about.\n',
  );
}

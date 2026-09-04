import { api, createEvent, integrity, isStackUp } from './helpers';

/**
 * Milestone 1 regression test.
 *
 * This is the test that must fail loudly if anyone — a refactor, a future
 * milestone, an AI assistant "simplifying" the service — removes the lock from
 * the seat decrement. It asserts the thing users care about (never sell the
 * same seat twice), not the implementation detail (that a FOR UPDATE appears
 * in the SQL).
 *
 * Requires the stack: BOOKING_LOCK_STRATEGY must not be `none`.
 */
describe('Milestone 1 — concurrent bookings never oversell', () => {
  const SEATS = 100;
  const CONCURRENT_REQUESTS = 200;

  beforeAll(async () => {
    if (!(await isStackUp())) {
      throw new Error(
        `No API at ${process.env.BASE_URL ?? 'http://localhost:8080'} — run \`docker compose up -d\` first.`,
      );
    }
  });

  it(`sells exactly ${SEATS} seats when ${CONCURRENT_REQUESTS} requests arrive at once`, async () => {
    const eventId = await createEvent(SEATS, `race-${Date.now()}`);

    // Promise.all, not a loop with await: the requests have to overlap in time
    // or the race window never opens and the test proves nothing.
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
        api()
          .post(`/v1/events/${eventId}/bookings`)
          // A distinct user per request, so each gets its own rate-limit bucket
          // and this stays a test about locking rather than about throttling.
          .send({ userId: `racer-${index}`, quantity: 1 })
          .then((response) => response.status),
      ),
    );

    const created = responses.filter((status) => status === 201).length;
    const soldOut = responses.filter((status) => status === 409).length;

    expect(created).toBe(SEATS);
    expect(created + soldOut).toBe(CONCURRENT_REQUESTS);

    const report = await integrity(eventId);
    expect(report.oversoldBy).toBe(0);
    expect(report.confirmedSeats).toBe(SEATS);
    expect(report.availableSeats).toBe(0);
    // The counter and the bookings table must tell the same story. A drift here
    // means the decrement and the insert were not one atomic decision.
    expect(report.counterDrift).toBe(false);
  });

  it('rejects a booking for more seats than remain rather than going negative', async () => {
    const eventId = await createEvent(3, `partial-${Date.now()}`);

    const first = await api()
      .post(`/v1/events/${eventId}/bookings`)
      .send({ userId: 'greedy', quantity: 2 });
    expect(first.status).toBe(201);

    const second = await api()
      .post(`/v1/events/${eventId}/bookings`)
      .send({ userId: 'greedier', quantity: 2 });
    expect(second.status).toBe(409);

    const report = await integrity(eventId);
    expect(report.availableSeats).toBe(1);
    expect(report.oversoldBy).toBe(0);
  });
});

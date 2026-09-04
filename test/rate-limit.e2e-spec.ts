import { api, createEvent, isStackUp } from './helpers';

/**
 * Milestone 7 regression test.
 *
 * Deliberately asserts a range rather than an exact count: the bucket refills
 * while the burst is in flight, so "exactly capacity requests succeed" would be
 * a flaky assertion about wall-clock timing. What must hold is that the limiter
 * bounds the traffic and that a throttled client is told when to return.
 */
describe('Milestone 7 — the write endpoint is bounded', () => {
  beforeAll(async () => {
    if (!(await isStackUp())) {
      throw new Error('No API reachable — run `docker compose up -d` first.');
    }
  });

  it('sheds the excess with 429 and a Retry-After header', async () => {
    const eventId = await createEvent(1000, `rl-${Date.now()}`);
    const capacity = Number(process.env.RATE_LIMIT_CAPACITY ?? 20);
    const burst = capacity + 30;

    const responses = await Promise.all(
      Array.from({ length: burst }, () =>
        api()
          .post(`/v1/events/${eventId}/bookings`)
          // One identity => one bucket, shared by every api replica.
          .send({ userId: 'one-noisy-user', quantity: 1 }),
      ),
    );

    const accepted = responses.filter((response) => response.status === 201);
    const throttled = responses.filter((response) => response.status === 429);

    expect(accepted.length + throttled.length).toBe(burst);
    expect(throttled.length).toBeGreaterThan(0);
    // The bucket may refill mid-burst, but it must not let the whole burst past.
    expect(accepted.length).toBeLessThanOrEqual(capacity + 10);

    for (const response of throttled) {
      expect(response.headers['retry-after']).toBeDefined();
    }
  });

  it('does not throttle different users against each other', async () => {
    const eventId = await createEvent(1000, `rl-multi-${Date.now()}`);

    const responses = await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        api()
          .post(`/v1/events/${eventId}/bookings`)
          .send({ userId: `quiet-user-${index}`, quantity: 1 }),
      ),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
  });
});

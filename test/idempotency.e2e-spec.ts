import { randomUUID } from 'node:crypto';
import { api, createEvent, integrity, isStackUp } from './helpers';

/**
 * Milestone 2 regression test — the retrying client must not be charged twice.
 */
describe('Milestone 2 — Idempotency-Key collapses retries', () => {
  beforeAll(async () => {
    if (!(await isStackUp())) {
      throw new Error('No API reachable — run `docker compose up -d` first.');
    }
  });

  it('creates one booking from five sequential retries and replays the response', async () => {
    const eventId = await createEvent(10, `idem-seq-${Date.now()}`);
    const key = randomUUID();
    const payload = { userId: 'retrying-client', quantity: 1 };

    const responses = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      responses.push(
        await api()
          .post(`/v1/events/${eventId}/bookings`)
          .set('Idempotency-Key', key)
          .send(payload),
      );
    }

    // Every response is the original one, byte for byte — including the id.
    const ids = responses.map((response) => response.body.id as string);
    expect(new Set(ids).size).toBe(1);
    expect(responses.every((response) => response.status === 201)).toBe(true);
    // The four replays say so, so a client can tell a replay from a fresh write.
    expect(responses.slice(1).every((r) => r.headers['idempotent-replay'] === 'true')).toBe(true);

    const report = await integrity(eventId);
    expect(report.confirmedSeats).toBe(1);
  });

  it('collapses concurrent retries too, without ever creating two bookings', async () => {
    const eventId = await createEvent(10, `idem-par-${Date.now()}`);
    const key = randomUUID();

    // The hard case: five copies in flight at once, none of which has finished.
    // Some will legitimately get a 409 "still in progress" — what must never
    // happen is two bookings.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        api()
          .post(`/v1/events/${eventId}/bookings`)
          .set('Idempotency-Key', key)
          .send({ userId: 'racing-client', quantity: 1 }),
      ),
    );

    const created = responses.filter((response) => response.status === 201);
    const inProgress = responses.filter((response) => response.status === 409);

    expect(created.length + inProgress.length).toBe(5);
    expect(new Set(created.map((r) => r.body.id as string)).size).toBe(1);

    const report = await integrity(eventId);
    expect(report.confirmedSeats).toBe(1);
  });

  it('refuses to reuse one key for a different request body', async () => {
    const eventId = await createEvent(10, `idem-mismatch-${Date.now()}`);
    const key = randomUUID();

    await api()
      .post(`/v1/events/${eventId}/bookings`)
      .set('Idempotency-Key', key)
      .send({ userId: 'client', quantity: 1 })
      .expect(201);

    // Same key, different intent. Replaying the old response here would be
    // wrong, and processing it would break the key's promise — so it is a 422.
    await api()
      .post(`/v1/events/${eventId}/bookings`)
      .set('Idempotency-Key', key)
      .send({ userId: 'client', quantity: 3 })
      .expect(422);

    const report = await integrity(eventId);
    expect(report.confirmedSeats).toBe(1);
  });

  it('still creates separate bookings when no key is sent', async () => {
    const eventId = await createEvent(10, `idem-none-${Date.now()}`);

    const first = await api()
      .post(`/v1/events/${eventId}/bookings`)
      .send({ userId: 'careless', quantity: 1 })
      .expect(201);
    const second = await api()
      .post(`/v1/events/${eventId}/bookings`)
      .send({ userId: 'careless', quantity: 1 })
      .expect(201);

    // Without a key there is nothing to deduplicate against. This is the
    // behaviour Milestone 2 starts from, kept explicit so the difference the
    // header makes is visible in the test file itself.
    expect(first.body.id).not.toBe(second.body.id);
    expect((await integrity(eventId)).confirmedSeats).toBe(2);
  });
});

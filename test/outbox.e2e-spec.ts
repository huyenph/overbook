import { api, createEvent, isStackUp, sleep } from './helpers';

interface OutboxStats {
  pending: number;
  published: number;
  failed: number;
  oldestPendingAt: string | null;
}

/**
 * Milestone 5 regression test — a committed booking always produces a published
 * event, eventually.
 */
describe('Milestone 5 — the outbox never loses an event', () => {
  const stats = async (): Promise<OutboxStats> =>
    (await api().get('/v1/outbox/stats').expect(200)).body as OutboxStats;

  beforeAll(async () => {
    if (!(await isStackUp())) {
      throw new Error('No API reachable — run `docker compose up -d` first.');
    }
  });

  it('writes an outbox row in the booking transaction and drains it to kafka', async () => {
    const before = await stats();
    const eventId = await createEvent(5, `outbox-${Date.now()}`);

    await api()
      .post(`/v1/events/${eventId}/bookings`)
      .send({ userId: 'outbox-user', quantity: 1 })
      .expect(201);

    // The relay polls on its own; drain explicitly so the test does not depend
    // on the poll interval.
    await api().post('/v1/outbox/drain').expect(201);

    let after = await stats();
    for (let attempt = 0; attempt < 10 && after.published <= before.published; attempt++) {
      await sleep(500);
      after = await stats();
    }

    expect(after.published).toBeGreaterThan(before.published);
    // Nothing may be parked as permanently failed by a healthy run.
    expect(after.failed).toBe(before.failed);
  });

  it('drains the backlog to zero, so no booking is left without its event', async () => {
    const eventId = await createEvent(20, `outbox-batch-${Date.now()}`);

    for (let index = 0; index < 5; index++) {
      await api()
        .post(`/v1/events/${eventId}/bookings`)
        .send({ userId: `batch-${index}`, quantity: 1 })
        .expect(201);
    }

    let current = await stats();
    for (let attempt = 0; attempt < 20 && current.pending > 0; attempt++) {
      await api().post('/v1/outbox/drain');
      await sleep(300);
      current = await stats();
    }

    expect(current.pending).toBe(0);
  });
});

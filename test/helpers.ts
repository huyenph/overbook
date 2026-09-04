import request from 'supertest';

/**
 * These run against the real stack (`docker compose up -d`), through nginx, not
 * against an in-process Nest app. The bugs being regression-tested here —
 * overselling, duplicate charges, lost events — only exist when real
 * concurrency meets a real Postgres, so an in-memory harness would happily pass
 * while production still oversold.
 */
export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';

export const api = () => request(BASE_URL);

export const isStackUp = async (): Promise<boolean> => {
  try {
    const response = await request(BASE_URL).get('/health/live').timeout(3000);
    return response.status === 200;
  } catch {
    return false;
  }
};

export const createEvent = async (totalSeats: number, name: string): Promise<string> => {
  const response = await api()
    .post('/v1/events')
    .send({
      name,
      venue: 'regression test',
      totalSeats,
      priceCents: 1000,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .expect(201);
  return response.body.id as string;
};

export const integrity = async (eventId: string) => {
  const response = await api().get(`/v1/events/${eventId}/integrity`).expect(200);
  return response.body as {
    totalSeats: number;
    availableSeats: number;
    confirmedSeats: number;
    oversoldBy: number;
    counterDrift: boolean;
  };
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

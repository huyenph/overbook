import http from 'k6/http';
import { check } from 'k6';

// nginx, not the api directly: every load test should go through the same path
// production traffic does, otherwise M8's load balancing is never exercised.
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Creates an event and returns its id. Called from k6 setup(). */
export function createEvent(totalSeats, name) {
  const response = http.post(
    `${BASE_URL}/v1/events`,
    JSON.stringify({
      name: name || `load-test ${new Date().toISOString()}`,
      venue: 'k6 arena',
      totalSeats: totalSeats,
      priceCents: 25000,
      // Always an explicit UTC instant — the API stores timestamptz.
      startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }),
    { headers: JSON_HEADERS },
  );

  check(response, { 'event created': (r) => r.status === 201 || r.status === 200 });
  return response.json('id');
}

export function bookSeat(eventId, userId, options) {
  const opts = options || {};
  const headers = Object.assign({}, JSON_HEADERS);
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  return http.post(
    `${BASE_URL}/v1/events/${eventId}/bookings`,
    JSON.stringify({ userId: userId, quantity: opts.quantity || 1 }),
    { headers: headers, tags: { name: 'POST /v1/events/:id/bookings' } },
  );
}

export function integrity(eventId) {
  return http.get(`${BASE_URL}/v1/events/${eventId}/integrity`).json();
}

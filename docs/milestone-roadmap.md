# Milestone Roadmap — Learning System Design by Breaking Things

> Principle: **every milestone starts by breaking the system in exactly the way the question describes, measuring it with real numbers, and only then learning the pattern that fixes it.** No theory before seeing the bug.

Running project: **A flash-sale event ticket booking system** — NestJS + Postgres + Redis + Docker Compose + k6 (load testing).

Each milestone specifies: **corresponding question(s)** (per `01-system-design-questions.md`) → **how to break it** → **pattern learned to fix it** → **acceptance criteria** → **regression test**.

> **On TDD:** this roadmap does **not** use full TDD (writing tests before code exists). For a beginner, writing a test before you've personally seen the bug is guesswork, not real TDD — and if the fix itself gets handed to AI to code, you lose exactly the part of the exercise meant to build deep understanding. Instead: fire the load test yourself, see the bug yourself, fix it by hand yourself first — **only then** write a regression test to lock that behavior in. This sits at the end of each milestone, takes about 15–20 minutes, and doesn't slow down the learning process.

---

## Milestone 0 — Baseline Measurement
**Corresponding questions:** 51 (estimation), 52 (health check), 65 (observability)
**Duration:** 1–2 weeks

- Docker Compose: Nest + Postgres + Redis + nginx
- Naive CRUD: `POST /events`, `POST /events/:id/book`, `GET /events/:id`
- Set up k6/autocannon for load testing; pino logs with `traceId`; Prometheus + Grafana reading p95/p99
- Write health check endpoints (`/health/live`, `/health/ready`)
- Before estimating real capacity, work through question 51 by hand: assume 100K users, 5% concurrently online during a sale window → estimate QPS, storage, bandwidth

**Acceptance criteria:** you can answer "what's this endpoint's p95 at 300 RPS, and where's the bottleneck?" with real numbers, not a guess.

**Regression test:** not needed — this is measurement infrastructure, there's no business behavior yet to lock in.

---

## Milestone 1 — Overselling Tickets (Race Condition)
**Corresponding questions:** 33 (Distributed Lock), 56 (Isolation Levels), 57 (Optimistic vs Pessimistic Lock)
**Duration:** 4–5 days

1. Fire 200 concurrent requests at k6 all buying the last available ticket
2. **Observe the bug:** `available_seats` goes negative, or more than 100 seats get sold out of 100
3. Learn: transaction isolation levels (Postgres's default Read Committed isn't enough), `SELECT ... FOR UPDATE` (pessimistic), or a `version` column (optimistic)
4. Fix it, rerun the exact same test, prove overselling is gone

**Acceptance criteria:** 200 concurrent requests for 100 seats → exactly 100 sold.

**Regression test:** an integration test firing 200 concurrent requests via `Promise.all`, asserting exactly 100 succeed. Run in CI so if anyone (including AI) accidentally removes the lock, the test fails immediately.

---

## Milestone 2 — Client Retries, Multiple Deductions (Idempotency)
**Corresponding questions:** 29 (Idempotency), 64 (Idempotency Key in Practice)
**Duration:** 3–4 days

1. Simulate a client that loses connection mid-request and automatically resends the identical request 3 times
2. **Observe the bug:** one user ends up with 3 bookings despite clicking the button once
3. Learn: design an `idempotency_keys` table (key, request_hash, response, expires_at), a middleware that checks the key before processing

**Acceptance criteria:** send the same idempotency key 5 times → only 1 booking is created, the other 4 responses return the same cached result.

**Regression test:** send 5 duplicate-key requests, assert only 1 row exists in the `bookings` table and all 5 responses are identical.

---

## Milestone 3 — DB Falls Over from Reads (Caching)
**Corresponding questions:** 21 (Caching), 22 (Cache Aside), 24 (Redis)
**Duration:** 3–4 days

1. Hammer `GET /events/:id` at 1000 RPS continuously
2. **Observe the bug:** Postgres CPU spikes, p95 jumps 10x
3. Learn: Cache-Aside pattern with Redis, TTL

**Acceptance criteria:** compare p95 before/after using real Grafana numbers.

**Regression test:** not required — this is a performance optimization, better measured via benchmark (k6) than unit/integration test. Optionally add a simple test asserting the cache is populated after the first GET (query Redis directly).

---

## Milestone 4 — Cache Expires All at Once (Cache Stampede)
**Corresponding questions:** 59 (Cache Stampede), 23 (Write Through vs Write Back)
**Duration:** 2–3 days

1. Set a short TTL (5s) on a hot key, fire continuous load timed to hit right as the TTL expires
2. **Observe the bug:** hundreds of requests slam the DB simultaneously on cache miss
3. Learn: anti-stampede locking (single-flight), TTL jitter, consider write-through for frequently changing data

**Acceptance criteria:** flush the hot cache key mid-load-test, DB doesn't spike.

**Regression test:** hard to write a reliable unit test for this kind of race condition — keep the k6 script that reproduces it as a manually-run benchmark instead of forcing it into CI.

---

## Milestone 5 — Lost Event Mid-Publish (Outbox Pattern)
**Corresponding questions:** 60 (Outbox Pattern), 27 (Message Queue), 37 (Event-Driven Architecture)
**Duration:** 4–5 days

1. After a booking succeeds, add a step that publishes a "send confirmation email" event to a queue (two separate statements: write to DB, then publish)
2. Deliberately throw an error right after the DB write, before the publish step (simulating a crash)
3. **Observe the bug:** the order sits in the DB but the email is never sent, and there's no way to detect it without manually checking
4. Learn: Outbox Pattern — write the order + event into the same Postgres transaction, a relay process reads the outbox table and publishes

**Acceptance criteria:** kill the process repeatedly right after the DB write; the event always ends up published exactly once after the relay runs.

**Regression test:** a test writing an order + outbox row in one transaction, simulating the relay not having run yet, asserting the outbox row is still `pending`; a separate test for the relay: assert that after it runs, `pending` becomes `sent` and the event shows up on the queue.

---

## Milestone 6 — Consumer Dies Mid-Job (Retry, DLQ, Backpressure)
**Corresponding questions:** 27 (Message Queue), 35 (Retry Mechanism), 61 (Backpressure)
**Duration:** 4–5 days

1. Use BullMQ, write a worker that sends emails, deliberately throw a random error 30% of the time
2. **Observe the bug:** jobs disappear or get stuck forever unprocessed; if the producer fires faster than the worker can process, the queue grows unbounded
3. Learn: retry + exponential backoff + jitter, dead-letter queue, limiting worker concurrency to create backpressure

**Acceptance criteria:** fire 10K jobs with a 30% random failure rate → every job is eventually either processed or lands in the DLQ with a clear log; none silently vanish.

**Regression test:** a test where the worker always throws, asserting the job appears in the DLQ after exactly N configured retries — no need to test all 10K jobs, just lock in the retry/DLQ behavior.

---

## Milestone 7 — Protecting the System from Its Own Traffic (Rate Limiting)
**Corresponding questions:** 26 (Rate Limiting), 50 (Distributed Rate Limiter)
**Duration:** 2–3 days

1. With caching + queue already in place, throw extremely heavy load at the `book` endpoint
2. **Observe the bug:** even with GET caching in place, the write endpoint still falls over because it's unbounded
3. Learn: Token Bucket via Redis + a Lua script (atomic, works correctly across multiple instances)

**Acceptance criteria:** exceeding the rate limit → returns 429 for exactly the right count, consistent even across 3 parallel instances.

**Regression test:** send (limit + 10) requests back to back, assert exactly `limit` of them return 2xx and the rest return 429.

---

## Milestone 8 — Real Horizontal Scaling
**Corresponding questions:** 3, 4 (Scaling), 5 (Load Balancer), 9, 10 (High Availability, Fault Tolerance), 53 (Graceful Shutdown)
**Duration:** 4–5 days

1. `docker compose up --scale api=3` + nginx as load balancer
2. Hunt down leftover state: in-memory cache, sessions, a cron job that now fires 3 times, socket connections pinned to one instance
3. **Deliberately** `kill -9` one container mid-load-test
4. Learn: graceful shutdown (SIGTERM → drain → exit), health checks so the LB automatically removes dead instances

**Acceptance criteria:** kill one container mid-load-test, no dropped requests, cron doesn't run duplicated.

**Regression test:** hard to fully automate in CI (needs real multi-container setup) — keep it as a manually-run operational checklist rather than forcing it into a unit test.

---

## Milestone 9 — Real-Time & Long-Lived Connections
**Corresponding questions:** 38 (WebSockets), 39 (Long Polling vs WebSockets), 49 (Real-Time Chat Design)
**Duration:** 1–2 weeks

- Socket.IO + Redis adapter to run across multiple instances (connect to one instance but broadcast across all)
- Presence (online/offline), message acks, reconnect with catch-up for missed messages

**Acceptance criteria:** two clients connected to two different instances can still chat in real time; disconnect one client's network, reconnecting delivers all messages missed while offline.

**Regression test:** a test using two simulated socket clients, disconnecting one mid-conversation then reconnecting, asserting the client receives all messages sent while it was offline.

---

## Milestone 10 — Splitting a Service, Accepting Distributed Trade-offs
**Corresponding questions:** 7 (API Gateway), 8 (Monolith vs Microservices), 13 (Replication), 34 (Circuit Breaker), 36 (Saga), 40 (Service Discovery), 62 (2PC vs Saga)
**Duration:** 2–3 weeks

1. Split out **exactly one** service from the monolith (e.g. the Notification Service)
2. Communicate via events, `traceId` propagated across services
3. Deliberately kill the Notification Service, call it from the main service
4. **Observe the bug:** the main request hangs/times out along with it, taking down the whole system even though the failure is in one secondary service (cascading failure)
5. Learn: Circuit Breaker (Closed/Open/Half-Open)
6. Add a refund flow for when a booking fails partway through a multi-step process → learn the Saga Pattern (compare with 2PC and why it doesn't fit microservices)
7. Set up a Postgres read replica for the read-heavy service, deliberately read right after a write → observe **replication lag**, data not yet synced

**Acceptance criteria:** turn off the Notification Service, the main booking flow still works normally (circuit breaker opens, no cascading failure).

**Regression test:** a test calling a mock service that always times out, asserting that after N failures the circuit breaker transitions to `Open` and subsequent calls fail fast (without waiting for the real timeout).

---

## Milestone 11 — Operations & Basic Security
**Corresponding questions:** 66 (API Design & Versioning), 67 (AuthN/AuthZ), 68 (Blue-Green/Canary), 69 (Chaos Engineering)
**Duration:** 2 weeks

- Add JWT + refresh tokens, try a basic OAuth2 flow (Google login)
- Version the API (`/v1`, `/v2`) without breaking existing clients
- Deploy via GitHub Actions with a blue-green or canary strategy
- Write an automated chaos script: randomly kill containers/inject network delay during a load test, and see whether everything you've learned so far (circuit breaker, retry, outbox) actually holds up

**Acceptance criteria:** run the chaos script for 30 minutes straight, the system self-recovers without manual intervention, logs/metrics clearly show what happened.

**Regression test:** a test asserting an expired JWT is rejected, and that a refresh token correctly issues a new access token; a test asserting the old `/v1` still works after `/v2` is added.

---

## Running in Parallel Throughout — Theory & Interview Practice
**Corresponding questions:** 1, 2, 11, 14, 17, 18, 19, 20 (remaining foundations), 31, 32 (Consistent Hashing, Leader Election — know the definitions, no need to implement), 41–50 (the 10 real-world system design problems)

- Runs alongside every milestone above, not treated as a separate final phase
- Practice 1–2 of questions 41–50 each week using a 45-minute structure: clarify requirements (5') → estimate (5', using the skill from question 51) → API + data model (10') → high-level diagram (10') → deep dive (10') → bottlenecks & failure modes (5')
- **Must be spoken out loud**, not just written down — this is a different skill from knowing the answer on paper

---

## Summary Table: Milestone → Questions

| Milestone | Questions in the 50+20 set |
|---|---|
| 0 — Baseline | 51, 52, 65 |
| 1 — Race Condition | 33, 56, 57 |
| 2 — Idempotency | 29, 64 |
| 3 — Caching | 21, 22, 24 |
| 4 — Cache Stampede | 59, 23 |
| 5 — Outbox Pattern | 60, 27, 37 |
| 6 — Retry/DLQ/Backpressure | 27, 35, 61 |
| 7 — Rate Limiting | 26, 50 |
| 8 — Horizontal Scaling | 3, 4, 5, 9, 10, 53 |
| 9 — Real-Time | 38, 39, 49 |
| 10 — Splitting a Service | 7, 8, 13, 34, 36, 40, 62 |
| 11 — Operations & Security | 66, 67, 68, 69 |
| Parallel track | 1, 2, 11, 12, 14–20, 15, 17–20, 25, 28, 30–32, 41–50, 54, 55, 58, 63, 70 |

> Questions **12 (Indexing), 15 (Partitioning vs Sharding), 25 (CDN), 28 (Kafka vs RabbitMQ), 30 (Bloom Filter), 54 (N+1), 55 (Pagination), 58 (Connection Pooling), 63 (CQRS), 70 (Multi-region)** don't get a dedicated hands-on milestone — they're hard to reproduce in the right production-like context within a mid-sized project. Learn them through reading + small standalone demos, lower priority than the group with dedicated milestones.

# Overbook

A flash-sale ticket booking backend, built as a hands-on system design lab.

Every part of it exists to make one distributed-systems failure reproducible on
a laptop. The pattern that fixes each failure is switchable at runtime through
the environment, so the **same** load test can show the bug and then show it
gone — if the test had to change between the two runs, it would not be evidence
of anything.

Stack: **NestJS · TypeScript · PostgreSQL · Redis · Kafka · nginx · Prometheus ·
Grafana · k6**, all on Docker Compose.

---

## Quick start

```bash
cp .env.example .env
docker compose up -d --build
```

Then:

| What | URL |
|---|---|
| API (through nginx) | http://localhost:8080 |
| Swagger UI | http://localhost:8080/docs |
| Grafana dashboard | http://localhost:3002 (anonymous viewer, or admin/admin) |
| Prometheus | http://localhost:9091 |
| Kafka UI | http://localhost:8081 |
| Postgres | `localhost:5434` — overbook/overbook |
| Redis | `localhost:6380` |

Smoke test:

```bash
curl -s localhost:8080/health/ready
```

`make help` lists the shortcuts for everything below.

---

## Why the ports look unusual

The compose project is named `overbook-lab` and publishes on 8080/5434/6380/
9091/3002 rather than the obvious 80/5432/6379/9090/3001. That is deliberate:
a sibling project on this machine already holds the obvious ports and answers to
the compose project name `overbook`. Sharing a project name would make this
stack adopt and recreate the other one's containers — and reuse its Postgres
volume under a different major version.

---

## The architecture, and what each piece is for

```
                      ┌──────────┐
   k6 / curl  ───────▶│  nginx   │  load balancer, DNS re-resolve, retry on 5xx
                      └────┬─────┘
                           │
                 ┌─────────▼─────────┐        ┌────────────┐
                 │   api (1..N)      │───────▶│   Redis    │ cache, locks, token bucket
                 │   NestJS          │        └────────────┘
                 │                   │
                 │  ┌─────────────┐  │        ┌────────────┐
                 │  │  booking    │──┼───────▶│ PostgreSQL │ seats + bookings + outbox
                 │  │ transaction │  │        └─────┬──────┘
                 │  └─────────────┘  │              │ FOR UPDATE SKIP LOCKED
                 │  ┌─────────────┐  │              │
                 │  │ outbox relay│◀─┼──────────────┘
                 │  └──────┬──────┘  │
                 └─────────┼─────────┘
                           │ publish
                      ┌────▼─────┐   booking.events
                      │  Kafka   │   booking.events.retry
                      └────┬─────┘   booking.events.dlq
                           │
                 ┌─────────▼─────────┐
                 │ notification      │  dedup, retry w/ jitter, DLQ, semaphore
                 │ consumer          │
                 └───────────────────┘
```

The seat decrement, the booking row and the outbox row are **one** transaction.
That single fact is what removes the dual-write problem: there is no window in
which a booking exists but its event does not.

---

## Milestone runbook

Each milestone is: break it, measure it, learn the pattern, prove the fix.
Full details in [`docs/milestones.md`](docs/milestones.md); the short version:

### M0 — Baseline
```bash
k6 run load-tests/00-baseline.js            # 300 RPS for 60s
```
Read p95/p99 off Grafana. The deliverable is a sentence with numbers in it, not
a passing test.

### M1 — Overselling (Q33, Q56, Q57)
```bash
make oversell-bug   && k6 run load-tests/01-oversell.js   # oversoldBy > 0
make oversell-fix   && k6 run load-tests/01-oversell.js   # oversoldBy = 0
```
Measured on this machine: with `BOOKING_LOCK_STRATEGY=none`, 200 concurrent
requests for 100 seats sold **200** and the counter still claimed 79 left. With
`pessimistic` or `optimistic`, exactly **100**.

### M2 — Retries charging twice (Q29, Q64)
```bash
k6 run load-tests/02-idempotency.js         # 50 users x 5 retries -> 50 bookings
```

### M3 — Reads flattening Postgres (Q21, Q22, Q24)
```bash
k6 run -e MODE=uncached load-tests/03-cache-read.js
k6 run -e MODE=cached   load-tests/03-cache-read.js
```
Same endpoint, one path bypasses the cache. Compare p95 in Grafana.

### M4 — Cache stampede (Q59, Q23)
```bash
k6 run load-tests/04-stampede.js
make stampede-flush        # in another terminal, mid-run
```
Watch `cache_single_flight_waits_total`. Re-run with
`CACHE_STAMPEDE_PROTECTION=false` to see the herd reach the database.

### M5 — Lost events (Q60, Q27, Q37)
```bash
make crash-mode      # publish after commit, then die in between
# book something -> the api exits, nginx answers 502
make restart-api     # `up -d` will not revive it: PID 1 is still alive
# the booking is in the database, the event is gone, nothing recorded the gap

make crash-safe      # same crash, but the event went through the outbox
# book something, then:
make restart-api
curl localhost:8080/v1/outbox/stats   # pending drains to 0, nothing lost
```

### M6 — Consumer dies mid-job (Q27, Q35, Q61)
```bash
NOTIFICATION_FAILURE_RATE=0.3 docker compose up -d api
k6 run load-tests/06-consumer-flood.js
make dlq
```
Every message must end up processed or in the DLQ. None may vanish.

### M7 — Unbounded writes (Q26, Q50)
```bash
make scale-3 && k6 run load-tests/07-rate-limit.js
```
The totals must not change when you scale from 1 replica to 3 — that is the
claim a distributed limiter makes, and why the counter lives in Redis.

### M8 — Horizontal scaling (Q3–Q5, Q9, Q10, Q53)
```bash
make scale-3
k6 run load-tests/08-scaling.js
make kill-one              # mid-run, in another terminal
```
No dropped requests. Try `docker stop` (SIGTERM, graceful) against
`docker kill` (SIGKILL, abrupt) and compare.

---

## Regression tests

```bash
pnpm test              # pure logic: backoff, jitter, fingerprints, semaphore
pnpm run test:e2e      # against the running stack, through nginx
```

The e2e tests deliberately run over HTTP against real Postgres, Redis and Kafka.
Overselling, double charges and lost events only exist when real concurrency
meets a real database; an in-process harness would pass while production still
oversold.

They assert user-visible outcomes — "never sell the same seat twice" — rather
than implementation details, so a refactor is free to change *how* the lock
works but not *whether* it holds.

---

## Conventions worth knowing before you edit

**Time is UTC, everywhere.** Every timestamp column is `timestamptz`, Postgres
runs with `timezone=UTC`, and the Node process sets `TZ=UTC` before anything
reads a clock. Responses serialise as ISO-8601 instants.

**Migrations are hand-written and reviewed.** `synchronize` is off in every
config. Each migration has a `down()` that actually reverses its `up()`. They
run in a one-shot `migrate` service so scaling the api does not race N
concurrent migration runners.

**The seat counter is not the source of truth.** `GET /v1/events/:id/integrity`
derives what was really sold from `SUM(bookings.quantity)`, because the counter
column is precisely the thing a race condition corrupts.

**Background work is safe to run on every replica.** The outbox relay uses
`FOR UPDATE SKIP LOCKED`, and the idempotency-key sweeper takes a short Redis
lease. Neither needs a designated leader, and neither runs three times when you
scale to three.

---

## Environment flags

`.env.example` is the full list, with comments. The ones that change behaviour
rather than just wiring:

| Variable | Effect |
|---|---|
| `BOOKING_LOCK_STRATEGY` | `none` oversells, `pessimistic` locks the row, `optimistic` compare-and-sets |
| `CACHE_ENABLED` | `false` sends every read to Postgres |
| `CACHE_STAMPEDE_PROTECTION` | `false` removes single-flight and stale-while-revalidate |
| `DIRECT_PUBLISH_MODE` | `true` publishes after commit instead of through the outbox |
| `FAULT_CRASH_AFTER_BOOKING_COMMIT` | kills the process between COMMIT and PUBLISH |
| `NOTIFICATION_FAILURE_RATE` | fraction of notification jobs that fail on purpose |
| `NOTIFICATION_CONCURRENCY` | in-flight cap on the consumer (backpressure) |
| `RATE_LIMIT_ENABLED` | `false` leaves the write endpoint unbounded |

---

## Source material

- [`docs/milestone-roadmap.md`](docs/milestone-roadmap.md) — the learning plan this implements
- [`docs/system-design-questions.md`](docs/system-design-questions.md) — the 70 questions the milestones map onto

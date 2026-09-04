# Milestone runbook

One section per milestone: how to break it, what you should see, the pattern
that fixes it, where it lives in this codebase, and how the fix is locked in.

Read [`milestone-roadmap.md`](milestone-roadmap.md) for the learning plan and
[`system-design-questions.md`](system-design-questions.md) for the question
numbers referenced here.

Assumed running: `docker compose up -d --build`. All URLs go through nginx on
`localhost:8080`, the same path production traffic would take.

---

## M0 — Baseline measurement · Q51, Q52, Q65

**Do**

```bash
k6 run load-tests/00-baseline.js          # 300 RPS, 60s
open http://localhost:3002                 # Grafana
```

**What you are collecting.** Not a pass/fail. The output of M0 is the ability to
say "at 300 RPS this endpoint's p95 is X ms and the bottleneck is Y" and point
at the panel that says so.

Work Q51 by hand before trusting the graph: 100K users, 5% online during a sale
window, 2 requests/minute each → `(100000 × 0.05 × 2) / 60 ≈ 167 req/s`. Then
compare against what the dashboard actually shows.

**In the code**

- `src/metrics/` — the registry and the HTTP interceptor. Note that `route` is
  the Express route template, never the raw URL: `/events/:id` keeps the label
  cardinality bounded, `/events/<uuid>` would mint a time series per event.
- `src/common/trace/` — one id per request, honoured from the inbound header so
  a trace spans nginx → api → Kafka, but validated first, because that header is
  attacker-controlled and lands in log lines.
- `src/health/health.controller.ts` — Q52. `/health/live` touches **no**
  dependency, on purpose: a liveness probe that pings Postgres makes every
  replica fail at once during a database blip, and the orchestrator then
  restarts the whole fleet. `/health/ready` is the one that checks dependencies.

---

## M1 — Overselling · Q33, Q56, Q57

**Break it**

```bash
make oversell-bug
k6 run load-tests/01-oversell.js
```

**What you should see.** Measured here: 200 concurrent requests for 100 seats
sold **200**, and the counter still claimed 79 seats left.

```json
{ "totalSeats": 100, "availableSeats": 79, "confirmedSeats": 200,
  "oversoldBy": 100, "counterDrift": true }
```

Both numbers are wrong, and they are wrong in *different* ways — that is the
tell. Every transaction read the same snapshot before any of them wrote, so
each one computed `availableSeats - 1` from stale data. Postgres's default
Read Committed does not prevent this; it never promised to.

**Fix it**

```bash
make oversell-fix
k6 run load-tests/01-oversell.js         # oversoldBy = 0
```

**The two options (Q57)**

| | Pessimistic | Optimistic |
|---|---|---|
| How | `SELECT ... FOR UPDATE` locks the row on read | `UPDATE ... WHERE version = :seen`, retry on 0 rows |
| Cost under contention | requests queue | requests retry, then exhaust their retries |
| Fits | flash sales — conflict is the norm | low-conflict updates |

Both are implemented and both pass the test. Switch with
`BOOKING_LOCK_STRATEGY` and compare `booking_lock_wait_seconds` between them —
the shape of that histogram is the difference between "waiting" and "redoing".

**In the code** `src/bookings/bookings.service.ts` — `decrementNaive`,
`decrementPessimistic`, `decrementOptimistic`.

**Locked in by** `test/booking-race-condition.e2e-spec.ts`. It uses
`Promise.all`, not a loop with `await`: the requests have to overlap in time or
the race window never opens and the test proves nothing.

---

## M2 — Retries charging twice · Q29, Q64

**Break it.** Send the same booking twice with no `Idempotency-Key`:

```bash
curl -X POST localhost:8080/v1/events/$EID/bookings \
  -H 'Content-Type: application/json' -d '{"userId":"u1","quantity":1}'
# ...again. Two bookings, one intent.
```

**Fix it.** Send the header. Then:

```bash
k6 run load-tests/02-idempotency.js       # 50 users x 5 retries -> 50 bookings
```

**The mechanism.** The claim is staked *before* the handler runs, with an
`INSERT ... ON CONFLICT DO NOTHING`, letting the primary key break the tie. That
is what makes it hold under real concurrency: two simultaneous retries cannot
both create the row.

| Situation | Answer |
|---|---|
| First request | row inserted `in_progress`, handler runs, response stored |
| Later retry | row `completed` → stored response replayed, `Idempotent-Replay: true` |
| Parallel retry | row `in_progress` → 409, retry shortly |
| Same key, different body | 422 — the key is being reused for a new intent |

Failures are **not** cached: the row is released so the client can retry the
same key once the transient cause is gone.

**In the code** `src/idempotency/`. The fingerprint sorts object keys, so
`{a,b}` and `{b,a}` are one request — a retry from a different HTTP library must
not read as a new intent.

**Locked in by** `test/idempotency.e2e-spec.ts`, including the hard case: five
copies in flight at once, none finished.

---

## M3 — Reads flattening Postgres · Q21, Q22, Q24

**Break it**

```bash
k6 run -e MODE=uncached load-tests/03-cache-read.js     # 1000 RPS
```

Watch Postgres CPU and the latency panel. Then:

```bash
k6 run -e MODE=cached load-tests/03-cache-read.js
```

Same endpoint; `/v1/events/:id/uncached` exists purely so the comparison is one
flag apart instead of a `git stash`.

**In the code** `src/redis/cache.service.ts` and `src/events/events.service.ts`.

Two decisions worth noticing: misses are cached **negatively**, so a flood of
requests for a nonexistent id cannot be used to walk past the cache; and cache
reads and writes fail open, because a cache is an optimisation and a Redis blip
should cost latency, not availability.

---

## M4 — Cache stampede · Q59, Q23

**Break it**

```bash
CACHE_TTL_SECONDS=5 CACHE_STAMPEDE_PROTECTION=false docker compose up -d api
k6 run load-tests/04-stampede.js
make stampede-flush                       # another terminal, mid-run
```

**What you should see.** Every in-flight request misses at the same instant and
they all query Postgres together. A spike, not a step.

**Fix it**

```bash
CACHE_TTL_SECONDS=5 CACHE_STAMPEDE_PROTECTION=true docker compose up -d api
```

Three defences, all in `CacheService`:

1. **TTL jitter** — keys written in one burst do not all expire in one second.
2. **Single flight** — only the Redis-lock winner queries the database; the
   losers wait briefly for its write. `cache_single_flight_waits_total` counts
   exactly the requests that did *not* hit Postgres.
3. **Stale-while-revalidate** — once past its freshness window an entry is still
   served while one request refreshes it in the background. Redis holds the
   entry for `ttl + CACHE_STALE_SECONDS` to make that possible.

There is a deliberate fallback: if the lock winner dies, waiters time out and
load directly. Correctness first, stampede protection second.

---

## M5 — Lost events · Q60, Q27, Q37

**Break it.** Publish after the commit, then die in between:

```bash
DIRECT_PUBLISH_MODE=true FAULT_CRASH_AFTER_BOOKING_COMMIT=true \
  docker compose up -d api
curl -X POST localhost:8080/v1/events/$EID/bookings \
  -H 'Content-Type: application/json' -d '{"userId":"u1","quantity":1}'
```

The api exits. The booking is in the database. The event is gone, and nothing
anywhere records that it should have existed. That last part is the real
problem: an error you cannot detect is worse than one you can.

A detail worth pausing on: for the next few seconds `docker compose ps` still
reports the api as **healthy** while nginx returns 502. The container's PID 1 is
the dev watcher, which is very much alive; only the app died. The healthcheck
does exercise the app (`curl /health/live`), so it flips to unhealthy — but only
after an interval or two. That lag is the reason a load balancer needs its own
readiness probe rather than trusting "the container is running".

Because PID 1 survived, `docker compose up -d api` will not revive it. Use:

```bash
make restart-api
```

**Fix it.** Same crash, outbox on:

```bash
make crash-safe
# book again, api dies again, then:
make restart-api
curl localhost:8080/v1/outbox/stats        # pending drains to 0
```

Measured here: after the crash the row sat at `pending|1`; after the restart the
relay published it and it read `published|1`. In direct-publish mode the same
crash left a committed booking with **no** outbox row and no event — nothing
anywhere recorded that a notification was owed.

The event was never lost, only late.

**The mechanism.** `OutboxService.enqueue` takes the caller's `EntityManager`
rather than opening its own — that signature *is* the pattern. Handing it a
fresh repository would quietly reintroduce the dual write.

The relay polls with `FOR UPDATE SKIP LOCKED`, so every replica can run its own
with no coordination: each poll takes a disjoint set of rows and skips whatever
a sibling holds. Publish happens before `COMMIT` on purpose — a crash in between
leaves the rows pending and they go out again on restart. At-least-once,
deliberately: duplicates are cheap to defend against downstream, lost events are
not.

**In the code** `src/outbox/`. **Locked in by** `test/outbox.e2e-spec.ts`.

---

## M6 — Consumer dies mid-job · Q27, Q35, Q61

**Break it**

```bash
NOTIFICATION_FAILURE_RATE=0.3 docker compose up -d api
k6 run load-tests/06-consumer-flood.js
```

**What must hold.** Not "everything succeeds" — 30% of jobs fail by design. The
acceptance criterion is that **every** message ends up either processed or in
the DLQ, and none silently vanish:

```bash
curl localhost:8080/v1/notifications/stats
curl localhost:8080/v1/outbox/stats
make dlq
```

**The three defences**

- **Retry topic.** A failed message is republished to `booking.events.retry`
  carrying its attempt count and a retry-at stamp, so one poisonous message
  never head-of-line blocks the main topic. Kafka has no delayed delivery, so
  the retry consumer waits out the remaining delay in-handler while
  heartbeating — that blocks its partition on purpose, which is what a delay
  queue is for, and why it is a separate topic.
- **DLQ.** Once the attempts are spent the message is parked in
  `booking.events.dlq` with the error attached. Unparseable payloads skip
  straight there: they can never succeed, so retrying them burns attempts for
  nothing.
- **Backpressure (Q61).** A semaphore caps in-flight work, so a producer
  outrunning the worker makes the *queue* grow — where it is visible and
  measurable — instead of the heap.

Backoff is exponential with **full jitter**. Exponential alone is not enough: a
thousand consumers backing off by exactly 2s return as one synchronised wave and
knock the recovering service over again.

**Exactly-once effects.** The handler claims the message id in
`processed_messages` before doing the work, so a redelivery loses the insert and
sends no second email. The claim is released on failure — otherwise a transient
error would become a permanently skipped notification.

**In the code** `src/notifications/`, `src/common/concurrency/semaphore.ts`.

---

## M7 — Unbounded writes · Q26, Q50

**Break it**

```bash
RATE_LIMIT_ENABLED=false docker compose up -d api
k6 run load-tests/07-rate-limit.js
```

The read path is cached and the queue absorbs the async work, and the write
endpoint still falls over, because nothing bounds it.

**Fix it**

```bash
RATE_LIMIT_ENABLED=true docker compose up -d api
make scale-3
k6 run load-tests/07-rate-limit.js
```

**The point of the exercise** is the last two lines. The totals must not change
when you go from 1 replica to 3. An in-memory limiter would quietly let three
times the configured traffic through the moment you scale out; that is the
entire reason the token bucket is a Lua script evaluated inside Redis, where the
whole read-modify-write is atomic and shared.

The bucket keys on user id before falling back to the forwarded IP, so one
aggressive client cannot burn the budget of everyone behind the same NAT. And it
fails open: a limiter that takes the API down when Redis blips is a worse outage
than the traffic it was shedding.

**In the code** `src/ratelimit/`, `TOKEN_BUCKET_LUA` in
`src/redis/redis.service.ts`. **Locked in by** `test/rate-limit.e2e-spec.ts`.

---

## M8 — Horizontal scaling · Q3, Q4, Q5, Q9, Q10, Q53

**Do**

```bash
make scale-3
k6 run load-tests/08-scaling.js
make kill-one                              # mid-run, another terminal
```

**Acceptance.** No dropped requests. nginx retries the in-flight request against
another replica, readiness removes the dead one from rotation, and the
per-replica Grafana panel shows traffic redistributing.

Then compare `docker stop` (SIGTERM) against `docker kill` (SIGKILL). The
graceful path should cost zero errors.

**The state hunt.** Scaling out is where leftover local state surfaces. In this
codebase it was found and removed in three places:

| Local state | Why it breaks at N>1 | Fix here |
|---|---|---|
| Rate limit counters | 3 processes → 3 budgets | Redis token bucket |
| Cache | 3 caches, 3 stampedes | shared Redis + single flight |
| Cron sweeper | fires 3× per minute | short Redis lease per tick |
| Outbox relay | would publish everything 3× | `FOR UPDATE SKIP LOCKED` |

The relay and the cron are worth contrasting. The relay needs no leader at all,
because the database can hand out disjoint work; the cron does, because "delete
expired rows" has no natural partition. Reach for a lock only when the work
cannot be partitioned.

**Graceful shutdown (Q53)** runs in the order that actually avoids dropped
requests:

```
SIGTERM → readiness starts failing → wait SHUTDOWN_DRAIN_MS for the balancer
        → stop accepting, finish in-flight work → exit
```

Closing the server immediately on SIGTERM is the common mistake: nginx keeps
routing to the container for another health-check interval, and every one of
those requests becomes a connection reset. `tini` is the container entrypoint so
SIGTERM reaches node at all.

**In the code** `src/main.ts`, `src/common/shutdown/lifecycle.service.ts`,
`nginx/nginx.conf`.

---

## Not covered by a milestone

Q12 indexing, Q15 partitioning vs sharding, Q25 CDN, Q28 Kafka vs RabbitMQ,
Q30 bloom filters, Q54 N+1, Q55 pagination, Q58 connection pooling, Q63 CQRS,
Q70 multi-region — the roadmap deliberately leaves these to reading and small
demos. Three of them do appear here in passing, because they were free:

- **Q55 pagination** — `GET /v1/events` is keyset, not offset.
- **Q58 connection pooling** — `DB_POOL_MAX`, with a connection timeout so a
  request fails fast instead of queueing invisibly on an exhausted pool.
- **Q54 N+1** — the integrity check aggregates in SQL rather than loading
  bookings and summing in JavaScript.

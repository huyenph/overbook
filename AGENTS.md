# AGENTS.md

## Project purpose

Overbook is a hands-on system-design lab disguised as a flash-sale ticket
booking backend. It is not primarily a product to optimize for feature breadth.
Each milestone makes a distributed-systems failure reproducible locally, measures
it, applies a named pattern, and proves the behavior with the same load test.

The core learning loop is:

1. Enable the intentionally broken behavior.
2. Reproduce the failure under realistic concurrency.
3. Measure the result in k6, Prometheus, Grafana, logs, or database state.
4. Enable or implement the corrective pattern.
5. Re-run the same experiment and record concrete before/after evidence.
6. Add a regression test for correctness when the behavior is automatable.

Preserve this loop when extending the project. A change that merely hides a
failure, changes the test between the broken and fixed runs, or replaces an
observable experiment with theory works against the purpose of the repository.

## Read these first

- `README.md`: current architecture, quick start, milestone commands, ports, and
  important conventions.
- `docs/milestones.md`: authoritative runbook for the implemented milestones;
  includes how to break, observe, fix, and verify each failure.
- `docs/milestone-roadmap.md`: learning plan through M11. M0-M8 are implemented;
  M9-M11 are future work, not current behavior.
- `docs/system-design-questions.md`: theory reference for questions Q1-Q70.
- `.env.example`: complete documented runtime configuration and fault switches.

When docs and code disagree, inspect the implementation and tests, correct the
stale documentation as part of the change, and do not silently assume roadmap
items already exist.

## Current scope and milestone map

- M0 (Q51, Q52, Q65): baseline measurement, bounded metric labels, tracing,
  liveness/readiness, Prometheus/Grafana.
- M1 (Q33, Q56, Q57): reproducible overselling plus pessimistic and optimistic
  locking strategies.
- M2 (Q29, Q64): HTTP idempotency key claim, replay, conflict, and fingerprinting.
- M3 (Q21, Q22, Q24): Redis cache-aside, including negative caching and fail-open
  behavior.
- M4 (Q23, Q59): TTL jitter, single-flight refill, stale-while-revalidate.
- M5 (Q27, Q37, Q60): transactional outbox, crash injection, scalable relay.
- M6 (Q27, Q35, Q61): Kafka retry topic, full-jitter backoff, DLQ, consumer
  deduplication, bounded concurrency.
- M7 (Q26, Q50): Redis/Lua distributed token bucket on booking writes.
- M8 (Q3-Q5, Q9, Q10, Q53): nginx load balancing, three replicas, leaderless or
  leased background work, graceful shutdown.
- M9-M11: planned only (real-time connections; service split/circuit breaker/
  saga/replication; auth/versioning/deployment/chaos).

## Architecture and request flow

Traffic and tests enter through nginx on port 8080, never directly through an
API container. nginx routes to one or more stateless NestJS API replicas. The
API uses PostgreSQL for authoritative business state and coordination, Redis for
cache/leases/rate limits, and Kafka for booking events and notification work.

Booking write flow:

`POST /v1/events/:eventId/bookings`
-> distributed rate-limit guard
-> optional idempotency claim
-> one PostgreSQL transaction containing seat decision + booking + outbox row
-> event cache invalidation
-> outbox relay publishes to Kafka
-> notification consumer deduplicates and processes, retries, or dead-letters.

The booking transaction is the main correctness boundary. The seat decrement,
booking insert, and outbox insert must continue to share one `EntityManager` and
one commit.

## Repository map

- `src/main.ts`, `src/app.module.ts`: bootstrap, URI versioning, global validation,
  logging, middleware, and shutdown hooks.
- `src/events/`: event creation/list/read and cached versus uncached read paths.
- `src/bookings/`: inventory concurrency strategies and booking transaction.
- `src/idempotency/`: request claim/replay and distributed cleanup lease.
- `src/redis/`: Redis client, locks, Lua token bucket, cache-aside/stampede logic.
- `src/outbox/`: transaction-bound enqueue and `FOR UPDATE SKIP LOCKED` relay.
- `src/kafka/`: topic bootstrap and idempotent producer wrapper.
- `src/notifications/`: consumer, dedup table, retry/DLQ, backpressure.
- `src/ratelimit/`: decorator and Redis-backed guard.
- `src/health/`, `src/metrics/`, `src/common/trace/`, `src/common/shutdown/`:
  operational behavior used across milestones.
- `src/migrations/`: hand-written TypeORM schema history.
- `test/`: HTTP end-to-end correctness tests against the real Compose stack.
- `load-tests/`: k6 experiments, one script per applicable milestone.
- `monitoring/`: Prometheus and provisioned Grafana configuration.
- `nginx/`, `docker-compose.yml`, `Dockerfile`: local production-like topology.

## Non-negotiable design invariants

- Time is UTC end to end. Use `timestamptz` and ISO-8601 instants; do not add
  local-time assumptions.
- Database schema changes require a reviewed migration with a real reversible
  `down()`. Keep `synchronize: false`. Migrations run in the one-shot `migrate`
  service, not on every API replica.
- PostgreSQL is the source of truth. `available_seats` is a deliberately
  corruptible teaching counter; integrity is derived from booking rows with SQL
  aggregation.
- `OutboxService.enqueue` must receive the caller's transaction manager. A new
  repository/transaction reintroduces the dual-write gap.
- Delivery is at-least-once; effects are deduplicated by `(message_id,
  consumer_group)`. Do not claim the entire pipeline is exactly-once.
- Outbox work is partitioned with `FOR UPDATE SKIP LOCKED`; cron work uses a
  short Redis lease. Any new background job must be safe with N API replicas.
- Cache and rate limiting intentionally fail open. Redis trouble may increase DB
  load or admit traffic, but should not directly make the API unavailable.
- Liveness checks the process only. Readiness checks dependencies and draining.
  Do not make dependency outages trigger fleet-wide liveness restarts.
- Metric labels must have bounded cardinality. Use route templates, never raw
  IDs/URLs, as Prometheus labels.
- Validate inbound trace IDs before logging/propagating them and redact secrets.
- k6 and e2e traffic must go through nginx so scaling/failover are exercised.

## Intentionally broken behavior: preserve it

The following are lesson controls, not cleanup opportunities:

- `BOOKING_LOCK_STRATEGY=none` keeps the naive read-modify-write race.
- The initial migration deliberately omits `CHECK (available_seats >= 0)` so M1
  can expose counter corruption.
- `DIRECT_PUBLISH_MODE=true` retains the unsafe post-commit publish path.
- `FAULT_CRASH_AFTER_BOOKING_COMMIT=true` deliberately exits the app process.
- Cache, stampede protection, outbox relay, consumer, and rate limiter can be
  disabled independently for before/after experiments.
- `/v1/events/:id/uncached` exists solely as the M3 comparison path.

Do not delete, normalize away, or make these paths safe unless a milestone is
being intentionally redesigned. Safe defaults still remain enabled in
`.env.example` and Compose.

## API and data conventions

- Public API uses URI versioning and currently lives under `/v1`; health,
  metrics, and Swagger are version-neutral where configured.
- DTOs use `class-validator`; global validation strips nothing silently:
  unknown fields are rejected and transformations are explicit.
- Monetary values are integer smallest units (`priceCents`), never floats.
- IDs are UUIDs. Entity properties are camelCase; PostgreSQL names are snake_case.
- Event listing uses keyset pagination. Avoid introducing offset pagination on
  hot or growing tables.
- Cache mutations must invalidate the corresponding event key.
- Kafka records carry stable message ID, event type, trace ID, and attempt
  headers. Choose partition keys according to the ordering guarantee required.
- Errors and tests should assert user-visible outcomes, not ORM or lock
  implementation details.

## Working on a milestone

Before changing code, identify the milestone and Q-number(s), then read its
runbook section. Keep the broken and fixed modes separated by configuration so
the same script can compare them. Add comments where a choice is educational or
counterintuitive, explaining the failure mode and trade-off rather than merely
restating the code.

For a new milestone, normally add or update all of:

- implementation and configuration in `src/` and `.env.example`;
- Compose/Make targets if operators need to switch modes;
- a reproducible k6 script or operational checklist;
- correctness-focused unit/e2e coverage where deterministic;
- Prometheus/Grafana observability needed to see the failure;
- `docs/milestones.md`, the roadmap status, and `README.md` summary.

Do not force timing-sensitive performance or failover experiments into flaky CI
tests. Keep those as explicit k6/manual runbooks; use automated tests for stable
correctness invariants.

## Commands and verification

Use pnpm (the repository pins `pnpm@11.20.0`).

```bash
pnpm test                 # unit tests, no external stack
pnpm run build            # TypeScript/Nest build
pnpm run lint             # ESLint + Prettier; modifies files
docker compose up -d --build
pnpm run test:e2e         # real Postgres/Redis/Kafka through nginx
make help                 # milestone and operational shortcuts
```

Run unit tests and build for normal TypeScript changes. Run the relevant e2e
test and k6 experiment when changing a distributed behavior; the Compose stack
must already be healthy. State clearly when a verification step was not run
because Docker, k6, or the stack was unavailable.

Useful local endpoints:

- API via nginx: `http://localhost:8080`
- Swagger: `http://localhost:8080/docs`
- Grafana: `http://localhost:3002`
- Prometheus: `http://localhost:9091`
- Kafka UI: `http://localhost:8081`
- Postgres host port: `5434`; Redis host port: `6380`; Kafka host port: `29092`

The unusual ports and Compose project name `overbook-lab` avoid collision with a
sibling stack. Do not change them casually or add `container_name` to `api`,
because named API containers cannot be scaled with Compose.

## Change discipline

- Preserve existing user changes and keep edits scoped to the active milestone.
- Prefer small, explicit implementations over abstractions that hide the pattern
  being taught.
- Update tests and docs in the same change when behavior or commands change.
- Never commit `.env`, credentials, generated `dist/`, local data, or benchmark
  claims that were not actually measured.
- Do not report a load-test acceptance criterion as passing without recording
  the observed values and configuration used.

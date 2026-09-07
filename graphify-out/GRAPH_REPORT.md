# Graph Report - overbook  (2026-09-07)

## Corpus Check
- Corpus is ~33,597 words - fits in a single context window. You may not need a graph.

## Summary
- 692 nodes · 1097 edges · 32 communities (22 shown, 8 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 42 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Booking and Concurrency
- Event Validation
- Booking HTTP API
- NestJS Modules
- Lint Toolchain
- Idempotency Persistence
- Runtime Dependencies
- Booking DTOs
- Load Test Scenarios
- Package and Jest Config
- Outbox Publishing
- Notification API
- Distributed System Architecture
- Health Checks
- TypeScript Build Config
- Runtime Configuration
- End-to-End Tests
- Build Outputs
- Concurrency Learning Model
- Nest CLI Config
- TypeORM TS Config
- Learning Controls
- Core Schema Migration
- Idempotency Migration
- Outbox Migration
- Consumer Dedup Migration
- Baseline and Theory
- Idempotency Learning
- Cache Learning
- pnpm Workspace

## God Nodes (most connected - your core abstractions)
1. `BookingEntity` - 22 edges
2. `MetricsService` - 21 edges
3. `RedisService` - 19 edges
4. `compilerOptions` - 19 edges
5. `KafkaService` - 18 edges
6. `createEvent()` - 17 edges
7. `BookingsService` - 17 edges
8. `scripts` - 16 edges
9. `EventEntity` - 16 edges
10. `CreateBookingDto` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Overbook Docker Compose Stack` --implements--> `Overbook Architecture`  [INFERRED]
  docker-compose.yml → README.md
- `Booking Transaction Correctness Boundary` --conceptually_related_to--> `Booking Transaction`  [INFERRED]
  AGENTS.md → README.md
- `Intentionally Broken Lesson Controls` --conceptually_related_to--> `Break Measure Fix Prove Loop`  [INFERRED]
  AGENTS.md → docs/milestone-roadmap.md
- `API Runtime Lesson Flags` --implements--> `Intentionally Broken Lesson Controls`  [INFERRED]
  docker-compose.yml → AGENTS.md
- `Graceful Shutdown Sequence` --conceptually_related_to--> `nginx Load Balancer`  [INFERRED]
  docs/milestones.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Implemented Milestone Learning Sequence** — docs_milestone_roadmap_m0_baseline_measurement, docs_milestone_roadmap_m1_overselling, docs_milestone_roadmap_m2_idempotency, docs_milestone_roadmap_m3_cache_aside, docs_milestone_roadmap_m4_cache_stampede, docs_milestone_roadmap_m5_transactional_outbox, docs_milestone_roadmap_m6_retry_dlq_backpressure, docs_milestone_roadmap_m7_distributed_rate_limiting, docs_milestone_roadmap_m8_horizontal_scaling [EXTRACTED 1.00]
- **Booking Event Delivery Flow** — readme_booking_transaction, readme_postgresql_source_of_truth, readme_kafka_event_pipeline, docs_milestone_roadmap_m5_transactional_outbox, docs_milestones_at_least_once_delivery [INFERRED 0.95]
- **M1 Concurrency Visual Scenarios** — visualizations_milestone_1_concurrency_control_no_lock_scenario, visualizations_milestone_1_concurrency_control_pessimistic_scenario, visualizations_milestone_1_concurrency_control_optimistic_scenario [EXTRACTED 1.00]

## Communities (32 total, 8 thin omitted)

### Community 0 - "Booking and Concurrency"
Cohesion: 0.06
Nodes (24): ApiExcludeEndpoint, Header, BOOKING_CONFIRMED, Semaphore, BookingConfirmedPayload, HEADER_ATTEMPTS, HEADER_ERROR, HEADER_EVENT_TYPE (+16 more)

### Community 1 - "Event Validation"
Cohesion: 0.06
Nodes (41): IsDateString, IsUUID, CreateEventDto, ApiProperty, IsInt, IsString, Length, Min (+33 more)

### Community 2 - "Booking HTTP API"
Cohesion: 0.06
Nodes (35): ApiConflictResponse, ApiCreatedResponse, ApiHeader, ApiTooManyRequestsResponse, ApiUnprocessableEntityResponse, JoinColumn, ManyToOne, Req (+27 more)

### Community 3 - "NestJS Modules"
Cohesion: 0.06
Nodes (33): AppModule, Module, BookingsModule, Module, CommonModule, Global, Module, LifecycleService (+25 more)

### Community 4 - "Lint Toolchain"
Cohesion: 0.04
Nodes (49): eslint, eslint-config-prettier, @eslint/eslintrc, @eslint/js, eslint-plugin-prettier, globals, jest, @nestjs/cli (+41 more)

### Community 5 - "Idempotency Persistence"
Cohesion: 0.06
Nodes (24): Cron, IdempotencyKeyEntity, IdempotencyStatus, Column, CreateDateColumn, Entity, Index, PrimaryColumn (+16 more)

### Community 6 - "Runtime Dependencies"
Cohesion: 0.04
Nodes (45): class-transformer, class-validator, dotenv, ioredis, kafkajs, @nestjs/common, @nestjs/config, @nestjs/core (+37 more)

### Community 7 - "Booking DTOs"
Cohesion: 0.07
Nodes (22): CreateBookingDto, ApiProperty, ApiPropertyOptional, IsInt, IsOptional, IsString, Length, Max (+14 more)

### Community 8 - "Load Test Scenarios"
Cohesion: 0.10
Nodes (26): options, setup(), options, SEATS, setup(), teardown(), options, setup() (+18 more)

### Community 9 - "Package and Jest Config"
Cohesion: 0.06
Nodes (35): description, jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, rootDir, testEnvironment, testRegex (+27 more)

### Community 10 - "Outbox Publishing"
Cohesion: 0.09
Nodes (19): OutboxMessageEntity, OutboxStatus, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, OutboxController (+11 more)

### Community 11 - "Notification API"
Cohesion: 0.11
Nodes (17): NotificationsController, ApiOperation, ApiTags, Controller, Get, NotificationsModule, Module, IncomingNotification (+9 more)

### Community 12 - "Distributed System Architecture"
Cohesion: 0.09
Nodes (23): Booking Transaction Correctness Boundary, One-Shot Migration Runner, Overbook Docker Compose Stack, M4 Cache Stampede Protection, M5 Transactional Outbox, M6 Retry DLQ and Backpressure, M7 Distributed Rate Limiting, M8 Horizontal Scaling (+15 more)

### Community 13 - "Health Checks"
Cohesion: 0.15
Nodes (12): HealthCheck, HealthController, ApiOperation, ApiTags, Controller, Get, HealthModule, Module (+4 more)

### Community 14 - "TypeScript Build Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+11 more)

### Community 15 - "Runtime Configuration"
Cohesion: 0.19
Nodes (6): AppConfiguration, BookingLockStrategy, configuration(), lockStrategy(), { database }, dataSourceOptions

### Community 16 - "End-to-End Tests"
Cohesion: 0.42
Nodes (7): api(), BASE_URL, createEvent(), integrity(), isStackUp(), sleep(), OutboxStats

### Community 17 - "Build Outputs"
Cohesion: 0.25
Nodes (7): dist, node_modules, **/*spec.ts, test, exclude, extends, ./tsconfig.json

### Community 18 - "Concurrency Learning Model"
Cohesion: 0.43
Nodes (7): M1 Overselling Tickets, Optimistic Locking, Pessimistic Locking, No-Lock Overselling Scenario, Optimistic Retry Scenario, Pessimistic Wait Scenario, Two-Transaction Race Visualization

### Community 19 - "Nest CLI Config"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 20 - "TypeORM TS Config"
Cohesion: 0.40
Nodes (4): compilerOptions, module, extends, ./tsconfig.json

### Community 21 - "Learning Controls"
Cohesion: 0.50
Nodes (4): Intentionally Broken Lesson Controls, Overbook Learning Loop, API Runtime Lesson Flags, Break Measure Fix Prove Loop

## Knowledge Gaps
- **146 isolated node(s):** `options`, `options`, `SEATS`, `options`, `options` (+141 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 320 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MetricsService` connect `Booking and Concurrency` to `Booking HTTP API`, `Idempotency Persistence`, `Booking DTOs`, `Outbox Publishing`, `Notification API`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `BookingEntity` connect `Booking HTTP API` to `Booking and Concurrency`, `Event Validation`, `NestJS Modules`, `Booking DTOs`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `KafkaService` connect `Booking and Concurrency` to `Outbox Publishing`, `Booking HTTP API`, `NestJS Modules`, `Health Checks`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `options`, `options`, `SEATS` to the rest of the system?**
  _146 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Booking and Concurrency` be split into smaller, more focused modules?**
  _Cohesion score 0.059907834101382486 - nodes in this community are weakly interconnected._
- **Should `Event Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.06229508196721312 - nodes in this community are weakly interconnected._
- **Should `Booking HTTP API` be split into smaller, more focused modules?**
  _Cohesion score 0.061495457721872815 - nodes in this community are weakly interconnected._
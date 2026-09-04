COMPOSE := docker compose

.PHONY: help up down clean ps logs rebuild migrate psql redis-cli test test-e2e lint scale-3 kill-one oversell-bug oversell-fix stampede-flush crash-mode crash-safe restart-api dlq

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Start the whole stack
	$(COMPOSE) up -d --build

down: ## Stop the stack (keeps volumes)
	$(COMPOSE) down

clean: ## Stop the stack and delete its data
	$(COMPOSE) down -v

ps: ## Show service status
	$(COMPOSE) ps

logs: ## Tail the api logs
	$(COMPOSE) logs -f api

rebuild: ## Rebuild and restart the api only
	$(COMPOSE) up -d --build api

migrate: ## Run pending migrations
	$(COMPOSE) run --rm migrate

psql: ## Open a psql shell
	$(COMPOSE) exec postgres psql -U overbook -d overbook

redis-cli: ## Open a redis shell
	$(COMPOSE) exec redis redis-cli

test: ## Unit tests
	pnpm test

test-e2e: ## Regression tests against the running stack
	pnpm run test:e2e

lint: ## Lint and autofix
	pnpm run lint

scale-3: ## M8 — run three api replicas behind nginx
	$(COMPOSE) up -d --scale api=3

kill-one: ## M8 — SIGKILL one replica mid-load-test
	docker kill -s KILL $$(docker ps -q -f name=overbook-lab-api | head -1)

oversell-bug: ## M1 — restart the api with the seat lock removed
	BOOKING_LOCK_STRATEGY=none $(COMPOSE) up -d api

oversell-fix: ## M1 — restart the api with the pessimistic lock
	BOOKING_LOCK_STRATEGY=pessimistic $(COMPOSE) up -d api

stampede-flush: ## M4 — expire every cached event at once, mid-load-test
	$(COMPOSE) exec redis sh -c "redis-cli --scan --pattern 'cache:event:*' | xargs -r redis-cli del"

crash-mode: ## M5 — publish after commit and die in between (loses the event)
	DIRECT_PUBLISH_MODE=true FAULT_CRASH_AFTER_BOOKING_COMMIT=true $(COMPOSE) up -d api

crash-safe: ## M5 — same crash, but through the outbox (event survives)
	FAULT_CRASH_AFTER_BOOKING_COMMIT=true $(COMPOSE) up -d api

restart-api: ## M5 — bring the api back after an injected crash
	$(COMPOSE) restart api

dlq: ## M6 — read the dead letter queue
	$(COMPOSE) exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
		--bootstrap-server localhost:9092 --topic booking.events.dlq --from-beginning --timeout-ms 5000

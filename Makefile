# Developer shortcuts. Requires Docker Compose v2 and GNU make.
COMPOSE      ?= docker compose
COMPOSE_PROD ?= docker compose --env-file .env.production -f docker-compose.prod.yml
BACKUP_DIR   ?= backups

.PHONY: up down logs build test lint seed backup restore clean

up: ## Build and start the dev stack, wait until healthy
	@test -f .env || { echo "Missing .env: run cp .env.example .env"; exit 1; }
	$(COMPOSE) up -d --build --wait --renew-anon-volumes
	$(COMPOSE) ps

down: ## Stop the dev stack (keeps data)
	$(COMPOSE) down --remove-orphans

logs: ## Follow logs (make logs s=api for one service)
	$(COMPOSE) logs -f --tail=100 $(s)

build: ## Build the production images
	$(COMPOSE_PROD) build

test: ## Run all tests inside the api container
	$(COMPOSE) run --rm --no-deps api npm test

lint: ## Run ESLint inside the api container
	$(COMPOSE) run --rm --no-deps api npm run lint

seed: ## Seed the dev database (no-op until a seed script exists)
	$(COMPOSE) exec api npm run seed -w @eas/api --if-present

backup: ## Dump the dev database to backups/<timestamp>.archive.gz
	@mkdir -p $(BACKUP_DIR)
	$(COMPOSE) exec -T mongo mongodump --quiet --archive --gzip > $(BACKUP_DIR)/mongo-$$(date +%Y%m%d-%H%M%S).archive.gz
	@ls -1t $(BACKUP_DIR) | head -1 | sed "s|^|Wrote $(BACKUP_DIR)/|"

restore: ## Restore a dump: make restore FILE=backups/<name>.archive.gz (drops existing data)
	@test -n "$(FILE)" || { echo "Usage: make restore FILE=backups/<name>.archive.gz"; exit 1; }
	$(COMPOSE) exec -T mongo mongorestore --quiet --archive --gzip --drop < $(FILE)

clean: ## Remove containers, volumes (DATA LOSS) and locally built images
	$(COMPOSE) --profile tools down -v --remove-orphans --rmi local

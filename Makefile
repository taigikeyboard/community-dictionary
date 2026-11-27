.PHONY: help setup test validate compile build preview ci worker-setup worker-dev

ARGS ?=

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

setup: ## Fetch the taigi-converter submodule and the npm packages (D3 for the tag bubbles)
	git submodule update --init --recursive
	npm ci

test: ## Run unit tests
	npm test

validate: ## Check every entry (ARGS="--base X --head Y")
	node scripts/validate.js $(ARGS)

compile: ## Compile entries
	node scripts/compile.js

build: ## Build the site into dist/
	node scripts/build-site.js

preview: build ## Build, then serve dist/ at http://127.0.0.1:8000
	node scripts/serve.js

ci: test validate build ## Same gates as the Pages workflow

worker-setup: ## Install wrangler for the submission Worker
	npm ci --prefix worker

worker-dev: ## Run the Worker locally at http://127.0.0.1:8787 (needs worker/.dev.vars)
	npm run dev --prefix worker

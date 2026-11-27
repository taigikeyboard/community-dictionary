.PHONY: help setup test validate compile build preview ci worker-setup worker-dev check-hanji preview-mock

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

check-hanji: ## Check the Taiwanese UI text's Hanji against 教典 (ODS=kautian.ods from https://sutian.moe.edu.tw/media/senn/ods/kautian.ods)
	node scripts/check-hanji.js $(ODS)

preview-mock: build ## Preview with a local fake Worker and fake GitHub: sign-in, 我的提交, 修改 (nothing is sent)
	node scripts/mock-worker.js

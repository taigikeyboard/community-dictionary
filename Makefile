.PHONY: help setup test validate compile build preview ci

ARGS ?=

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

setup: ## Fetch the taigi-converter submodule
	git submodule update --init --recursive

test: ## Run unit tests
	npm test

validate: ## Check every entry (ARGS="--base X --head Y")
	node scripts/validate.js $(ARGS)

compile: ## Compile entries
	node scripts/compile.js

build: ## Build the site into dist/
	node scripts/build-site.js

preview: build ## Build, then serve dist/ at http://127.0.0.1:8000
	python3 -m http.server 8000 --bind 127.0.0.1 -d dist

ci: test validate build ## Same gates as the Pages workflow

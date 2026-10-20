# Everything runs inside `devenv shell`. Nothing is installed globally.

PY := python
PYTEST := $(PY) -m pytest

.DEFAULT_GOAL := help
.PHONY: help setup test test-live mockup mockup-reset doctor verify lint fmt corpus

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Report the toolchain and confirm the venv is ready
	@echo "python: $$($(PY) --version)"
	@echo "node:   $$(node --version 2>/dev/null || echo 'not installed')"

test: ## Fast, offline tests (no models required)
	$(PYTEST) -m "not live"

test-live: ## Tests that hit the local Ollama
	$(PYTEST) -m live

verify: test ## What to run before pushing
	@$(PY) scripts/verify_workspace.py

corpus: ## List the source corpus and its citable passages
	@$(PY) scripts/verify_workspace.py --corpus

doctor: ## Check the local model setup
	@$(PY) scripts/verify_workspace.py --models

mockup: ## Run the vendored mockup on :8010
	@cd reference/mockup/clinical_compass_app && COMPASS_PORT=$${COMPASS_PORT:-8010} COMPASS_DEMO=1 exec $(PY) run_demo.py

mockup-reset: ## Same, with a fresh demo database
	@rm -rf reference/mockup/clinical_compass_app/data
	@$(MAKE) mockup

lint: ## Ruff, when it is installed
	@ruff check packages tests 2>/dev/null || echo "ruff not installed; skipping"

fmt: ## Ruff format, when it is installed
	@ruff format packages tests 2>/dev/null || echo "ruff not installed; skipping"

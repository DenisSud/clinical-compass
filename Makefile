SHELL := $(shell command -v bash 2>/dev/null || echo /bin/sh)
.DEFAULT_GOAL := help

.PHONY: help install dev build start test typecheck db-migrate db-reset

help: ## Показать доступные команды
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Поставить зависимости
	npm install

dev: ## Поднять API и веб-интерфейс для разработки (:3000 и :5173)
	npm run dev

build: ## Собрать SPA в server/public
	npm run build

start: ## Отдать API и собранный SPA с одного порта (:3000)
	npm run start

test: ## Прогнать тесты
	npm run test

typecheck: ## Проверить типы
	npm run typecheck

db-migrate: ## Применить миграции
	npm run db:migrate

db-reset: ## Удалить локальную базу
	rm -f var/app.db var/app.db-wal var/app.db-shm

# Демо-стенд

`https://compas.sudakov.site` — публичный адрес для команды и жюри.

| Что | Где |
| --- | --- |
| Приложение | pc, `/home/denis/apps/clinical-compass`, юнит `clinical-compass.service` (user systemd, `:8110`, bind `0.0.0.0`) |
| TLS и домен | pi, `/etc/caddy/Caddyfile`, блок `compas.sudakov.site` → `reverse_proxy 192.168.1.20:8110` |
| База | `var/demo.db` на pc: `var/app.db` после `npm run db:seed` плюс демо-действия из `scripts/demo-reset.sh` |

Обновить стенд после изменений в коде: `deploy/deploy.sh`. Скрипт синхронизирует дерево,
пересобирает фронт, перезапускает юнит. `npm ci` на pc требует тулчейн (better-sqlite3
собирается из исходников) и одобрения install-скриптов — это внутри скрипта.

Демо-доступ: `doctor@example.com`, `anna@example.com`, `mikhail@example.com`,
пароль `compass-demo-2026`.

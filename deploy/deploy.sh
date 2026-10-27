#!/usr/bin/env bash
# Выкатывает демо-стенд: синхронизирует дерево на pc, пересобирает, перезапускает юнит.
# Код там лежит в /home/denis/apps/clinical-compass; юнит это
# deploy/clinical-compass.service в ~/.config/systemd/user (то же содержимое).
# npm ci требует инструментов для better-sqlite3 и разрешённых install-скриптов
# (npm 11 блокирует их по умолчанию), отсюда nix shell ниже.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-pc}"
APP="/home/denis/apps/clinical-compass"

rsync -a --delete \
  --exclude node_modules --exclude var --exclude .git --exclude .scratch \
  ./ "$HOST:$APP/"
rsync -a deploy/clinical-compass.service "$HOST:.config/systemd/user/clinical-compass.service"

ssh "$HOST" "cd $APP && nix shell nixpkgs#gcc nixpkgs#gnumake nixpkgs#python3 -c bash -c \
  'npm ci --no-audit --no-fund >/dev/null && npm install-scripts approve better-sqlite3 esbuild >/dev/null && npm rebuild better-sqlite3 >/dev/null' \
  && npm run build >/dev/null \
  && systemctl --user daemon-reload && systemctl --user restart clinical-compass.service"

echo "deployed: http://192.168.1.20:8110 (public: https://compas.sudakov.site)"

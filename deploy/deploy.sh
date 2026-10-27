#!/usr/bin/env bash
# Deploy the demo stand: sync the tree to pc, rebuild, restart the unit.
# Code lives in /home/denis/apps/clinical-compass there; the unit is
# deploy/clinical-compass.service in ~/.config/systemd/user (same content).
# npm ci needs a toolchain for better-sqlite3 and its install scripts approved
# (npm 11 blocks them by default), hence the nix shell below.
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

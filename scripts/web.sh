#!/usr/bin/env bash
# Start/stop the demo app. A pid file, no pkill: the pattern would match the
# command line of the shell that runs it.
set -euo pipefail
cd "$(dirname "$0")/.."
PID=tmp/web.pid
UVICORN=.devenv/state/venv/bin/uvicorn

case "${1:-start}" in
  start)
    mkdir -p tmp
    if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
      echo "already running: $(cat "$PID")"; exit 0
    fi
    "$UVICORN" apps.web.app:app --host 0.0.0.0 --port 8030 --log-level warning \
      > tmp/web.log 2>&1 &
    echo $! > "$PID"
    echo "started: $(cat "$PID")"
    ;;
  stop)
    if [ -f "$PID" ]; then kill "$(cat "$PID")" 2>/dev/null || true; rm -f "$PID"; fi
    echo stopped
    ;;
  *) echo "usage: $0 start|stop"; exit 2 ;;
esac

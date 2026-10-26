#!/usr/bin/env bash
# Пересобрать демо-базу: копия var/app.db + те же действия, что делает пациент и врач.
# Требует запущенного сервера на $PORT (по умолчанию 3111) и живого seed-а в var/app.db.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3111}"
BASE="http://127.0.0.1:$PORT"
JAR=$(mktemp)

sqlite3 var/app.db "PRAGMA wal_checkpoint(FULL);" >/dev/null 2>&1 || true
rm -f var/demo.db var/demo.db-wal var/demo.db-shm
cp var/app.db var/demo.db
echo "demo.db пересоздана. Перезапусти сервер, чтобы он открыл новую базу:"
echo "  env PORT=$PORT NODE_ENV=production SQLITE_DB=var/demo.db npx tsx server/index.ts"
echo "после перезапуска повтори этот скрипт с --replay"
[ "${1:-}" = "--replay" ] || exit 0

signin() { curl -s -c "$JAR" -X POST "$BASE/api/auth/$1/signin" -H 'content-type: application/json' \
  -d "{\"email\":\"$2\",\"password\":\"compass-demo-2026\"}" -o /dev/null -w "%{http_code} $1 signin\n"; }
post() { curl -s -b "$JAR" -X "$1" "$BASE$2" -H 'content-type: application/json' -d "$3" -o /dev/null -w "%{http_code} $2\n"; }

signin patient anna@example.com
post POST /api/assessments/phq-9 '{"submissionId":"demo-phq-1","answers":{"q1":3,"q2":2,"q3":3,"q4":2,"q5":1,"q6":2,"q7":3,"q8":1,"q9":2}}'
post POST /api/diary '{"submissionId":"demo-diary-1","value":2,"comment":"Тяжело вставать по утрам, к вечеру отпускает."}'
post PUT /api/facts '{"egfrMlMin":45}'
post POST /api/messages '{"body":"Здравствуйте. После повышения дозы почти не сплю, к вечеру совсем нет сил."}'

rm -f "$JAR"
signin doctor doctor@example.com
PID=$(curl -s -b "$JAR" "$BASE/api/patients" | python3 -c "import json,sys; print(json.load(sys.stdin)['patients'][0]['id'])")
post POST "/api/patients/$PID/messages" '{"body":"Здравствуйте, Анна. Спасибо, что написали. Обсудим сон и дозу на приёме в четверг, раньше ничего не меняйте."}'
curl -s -b "$JAR" "$BASE/api/signals" | python3 -c "
import json,sys
items=json.load(sys.stdin)['signals']
print(len(items), 'сигналов')
for s in items: print(' ', s['severity'], '|', s['status'], '|', s['title'])
"
rm -f "$JAR"

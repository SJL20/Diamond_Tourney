#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PB_PORT="${PB_PORT:-8097}"
BASE="http://127.0.0.1:${PB_PORT}"

python3 -m unittest scripts.test_metrics -v

if ! curl -sf "$BASE/api/health" >/dev/null; then
  bash "$ROOT/scripts/install-pocketbase.sh"
  bash "$ROOT/scripts/start-pocketbase.sh" >"$ROOT/pb/pb_data/ci-server.log" 2>&1 &
  echo $! >"$ROOT/pb/pb_data/ci-server.pid"
  for i in $(seq 1 40); do
    if curl -sf "$BASE/api/health" >/dev/null; then
      break
    fi
    sleep 0.5
  done
fi

curl -sf "$BASE/api/health" >/dev/null
python3 "$ROOT/scripts/acceptance_test.py"

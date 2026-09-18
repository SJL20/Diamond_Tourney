#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PB_PORT="${PB_PORT:-8097}"
export PB_URL="http://127.0.0.1:${PB_PORT}"

# Most of the suite talks to a live server, so bring PocketBase up first.
# ensure-pocketbase.sh installs the binary, creates pb_data, reuses a healthy
# listener, waits for /api/health, and returns.
bash "$ROOT/scripts/ensure-pocketbase.sh"

python3 -m unittest scripts.test_metrics scripts.test_diamond -v
python3 "$ROOT/scripts/acceptance_test.py"

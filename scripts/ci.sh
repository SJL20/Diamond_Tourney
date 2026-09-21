#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PB_PORT="${PB_PORT:-8097}"
export PB_URL="http://127.0.0.1:${PB_PORT}"

python3 "$ROOT/scripts/check_migration_safety.py"

# PDF box extract shells out to pdftotext. CI images do not ship it.
if ! command -v pdftotext >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1 && [[ "$(id -u)" -ne 0 ]]; then
      sudo apt-get update -qq
      sudo apt-get install -y -qq poppler-utils
    else
      apt-get update -qq
      apt-get install -y -qq poppler-utils
    fi
  fi
fi
if ! command -v pdftotext >/dev/null 2>&1; then
  echo "pdftotext is required for PDF box extract" >&2
  exit 1
fi

# Most of the suite talks to a live server, so bring PocketBase up first.
# ensure-pocketbase.sh installs the binary, creates pb_data, reuses a healthy
# listener, waits for /api/health, and returns.
bash "$ROOT/scripts/ensure-pocketbase.sh"

python3 -m unittest scripts.test_metrics scripts.test_pdf_box scripts.test_diamond -v
python3 "$ROOT/scripts/acceptance_test.py"

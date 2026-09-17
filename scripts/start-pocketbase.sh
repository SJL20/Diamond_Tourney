#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PB_PORT:-8097}"
BIN="$ROOT/tools/pocketbase"
if [[ ! -x "$BIN" ]]; then
  bash "$ROOT/scripts/install-pocketbase.sh"
fi
mkdir -p "$ROOT/pb/pb_data"
exec "$BIN" serve \
  --http="0.0.0.0:${PORT}" \
  --dir="$ROOT/pb/pb_data" \
  --migrationsDir="$ROOT/pb/pb_migrations" \
  --hooksDir="$ROOT/pb/pb_hooks" \
  --publicDir="$ROOT/pb/pb_public" \
  --dev

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PB_PORT:-8097}"
BIN="$ROOT/tools/pocketbase"
if [[ ! -x "$BIN" ]]; then
  bash "$ROOT/scripts/install-pocketbase.sh"
fi
mkdir -p "$ROOT/pb/pb_data"
# Cloud Preview: do not recycle a healthy listener. --dev RST's the tunnel on hook edits.
if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  echo "PocketBase already healthy on http://127.0.0.1:${PORT}"
  exit 0
fi
args=(serve
  --http="0.0.0.0:${PORT}"
  --dir="$ROOT/pb/pb_data"
  --migrationsDir="$ROOT/pb/pb_migrations"
  --hooksDir="$ROOT/pb/pb_hooks"
  --publicDir="$ROOT/pb/pb_public"
)
if [[ "${PB_DEV:-0}" == "1" ]]; then
  args+=(--dev)
fi
exec "$BIN" "${args[@]}"

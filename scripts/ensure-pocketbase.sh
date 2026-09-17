#!/usr/bin/env bash
# Cloud Agent `start`: make PocketBase healthy, then return.
# Do not exec the server here — a blocking start hangs boot and Preview port-forward.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PB_PORT:-8097}"
LOG="${PB_LOG:-/tmp/pocketbase-${PORT}.log}"
PIDFILE="${PB_PIDFILE:-/tmp/pocketbase-${PORT}.pid}"
BIN="$ROOT/tools/pocketbase"

healthy() {
  curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/health" | grep -q healthy
}

if [[ ! -x "$BIN" ]]; then
  bash "$ROOT/scripts/install-pocketbase.sh"
fi
mkdir -p "$ROOT/pb/pb_data"
touch "$LOG"

if ! healthy; then
  if pgrep -f "${BIN} serve" >/dev/null; then
    echo "PocketBase is running but not healthy yet; waiting on :${PORT}"
  else
    # No --dev: file-watch restarts RST the Desktop Preview tunnel.
    nohup "$BIN" serve \
      --http="0.0.0.0:${PORT}" \
      --dir="$ROOT/pb/pb_data" \
      --migrationsDir="$ROOT/pb/pb_migrations" \
      --hooksDir="$ROOT/pb/pb_hooks" \
      --publicDir="$ROOT/pb/pb_public" \
      >>"$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    echo "Started PocketBase pid $(cat "$PIDFILE") on :${PORT}"
  fi
  for _ in $(seq 1 40); do
    if healthy; then
      break
    fi
    sleep 0.25
  done
  if ! healthy; then
    echo "PocketBase failed to become healthy on :${PORT}" >&2
    tail -n 80 "$LOG" >&2 || true
    exit 1
  fi
fi

echo "PocketBase healthy on http://127.0.0.1:${PORT}"
if [[ "${1:-}" == "--attach" ]]; then
  exec tail -n 80 -f "$LOG"
fi

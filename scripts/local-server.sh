#!/usr/bin/env bash
# Start the local Diamond Tourney server (PocketBase on :8097) and print the
# Keystone Clash URLs. Safe to re-run — will not kill a healthy listener.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PB_PORT:-8097}"
bash "$ROOT/scripts/ensure-pocketbase.sh"
BASE="http://127.0.0.1:${PORT}"
cat <<EOF

Diamond Tourney is serving on ${BASE}

  Hosted Keystone board   ${BASE}/t/keystone-clash-2026
  Harbor Eight (FAKE)     ${BASE}/t/harbor-eight
  Full stats              ${BASE}/t/keystone-clash-2026/stats
  Info / parking / raffle ${BASE}/t/keystone-clash-2026/info
  Original popup pages    ${BASE}/popup/index.html
  Popup stats board       ${BASE}/popup/stats.html
  Full rules              ${BASE}/popup/full-rules.html
  Rain / Sunday venue     ${BASE}/popup/rain-update.html
  Find a tournament       ${BASE}/find
  2026 year board         ${BASE}/year/2026

Local logins (sample):
  Director   td@local.test / EventTd1!
  Region     owner@local.test / RegionAdmin1!

EOF

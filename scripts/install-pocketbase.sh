#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${PB_VERSION:-0.40.4}"
DEST="$ROOT/tools/pocketbase"
mkdir -p "$ROOT/tools"
if [[ -x "$DEST" ]]; then
  echo "PocketBase already installed at $DEST"
  exit 0
fi
ZIP="$ROOT/tools/pocketbase.zip"
URL="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/pocketbase_${VERSION}_linux_amd64.zip"
echo "Downloading PocketBase ${VERSION}..."
curl -sL "$URL" -o "$ZIP"
unzip -o "$ZIP" -d "$ROOT/tools" pocketbase
chmod +x "$DEST"
rm -f "$ZIP"
echo "Installed $DEST"

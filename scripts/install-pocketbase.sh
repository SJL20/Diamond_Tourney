#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${PB_VERSION:-0.40.4}"

# Map this machine to a PocketBase GitHub release asset (linux_amd64, darwin_arm64, …).
# Override with PB_UNAME_S / PB_UNAME_M when testing the mapping.
pb_release_asset() {
  local os arch
  os="$(echo "${PB_UNAME_S:-$(uname -s)}" | tr '[:upper:]' '[:lower:]')"
  arch="${PB_UNAME_M:-$(uname -m)}"
  case "$os" in
    linux) os=linux ;;
    darwin) os=darwin ;;
    mingw*|msys*|cygwin*|windows_nt|windows) os=windows ;;
    *)
      echo "Unsupported OS: $os" >&2
      return 1
      ;;
  esac
  case "$arch" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l|armv7) arch=armv7 ;;
    *)
      echo "Unsupported architecture: $arch" >&2
      return 1
      ;;
  esac
  echo "${os}_${arch}"
}

if [[ "${1:-}" == "--print-asset" ]]; then
  pb_release_asset
  exit 0
fi

DEST="$ROOT/tools/pocketbase"
mkdir -p "$ROOT/tools"
if [[ -x "$DEST" ]]; then
  echo "PocketBase already installed at $DEST"
  exit 0
fi

ASSET="$(pb_release_asset)"
ZIP="$ROOT/tools/pocketbase.zip"
URL="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/pocketbase_${VERSION}_${ASSET}.zip"
echo "Downloading PocketBase ${VERSION} (${ASSET})..."
curl -sL "$URL" -o "$ZIP"
unzip -o "$ZIP" -d "$ROOT/tools" pocketbase
chmod +x "$DEST"
rm -f "$ZIP"
echo "Installed $DEST"

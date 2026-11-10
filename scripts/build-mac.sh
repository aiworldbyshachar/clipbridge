#!/bin/bash
# Builds ClipBridge on a Mac and installs it into /Applications.
# Run from Terminal inside the project folder:   bash scripts/build-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org (LTS), then run this again."
  exit 1
fi

echo "› Installing dependencies…"
npm install --no-audit --no-fund
# Some npm versions skip Electron's download step; make sure the binary is there.
[ -d node_modules/electron/dist ] || node node_modules/electron/install.js

ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH=x64

echo "› Building the app ($ARCH)…"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir "--$ARCH" --publish never

APP=$(find dist -maxdepth 2 -name 'ClipBridge.app' -type d | head -n 1)
if [ -z "$APP" ]; then
  echo "The build didn't produce ClipBridge.app - see the errors above."
  exit 1
fi

echo "› Installing into /Applications…"
osascript -e 'quit app "ClipBridge"' >/dev/null 2>&1 || true
rm -rf /Applications/ClipBridge.app
cp -R "$APP" /Applications/
xattr -cr /Applications/ClipBridge.app
# Apple Silicon only runs signed apps; a local ad-hoc signature is enough.
codesign --verify --deep /Applications/ClipBridge.app >/dev/null 2>&1 ||
  codesign --force --deep --sign - /Applications/ClipBridge.app

open /Applications/ClipBridge.app
echo "✓ ClipBridge is installed and running - it's in the Dock and the menu bar."

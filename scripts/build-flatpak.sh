#!/usr/bin/env bash
#
# Build and install Rommix as a flatpak.
#
# Two stages: npm produces the Electron application tree, then flatpak-builder
# packages that tree. Run from the repository root.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_ID="be.bl_it.Rommix"
MANIFEST="flatpak/${APP_ID}.yml"
BUILD_DIR="build/flatpak"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: $1 is not installed." >&2
    [ -n "${2:-}" ] && echo "  $2" >&2
    exit 1
  }
}

require npm
require flatpak
require flatpak-builder "Install it with: flatpak install -y flathub org.flatpak.Builder"

echo "==> Checking flatpak runtimes"
for ref in \
  "org.freedesktop.Platform//24.08" \
  "org.freedesktop.Sdk//24.08" \
  "org.electronjs.Electron2.BaseApp//24.08"
do
  if ! flatpak info "$ref" >/dev/null 2>&1; then
    echo "    installing $ref"
    flatpak install -y --noninteractive flathub "$ref"
  fi
done

echo "==> Building the application bundle"
npm run pack:dir

if [ ! -d dist/linux-unpacked ]; then
  echo "error: dist/linux-unpacked was not produced by electron-builder." >&2
  exit 1
fi

echo "==> Building the flatpak"
flatpak-builder \
  --force-clean \
  --user \
  --install \
  --install-deps-from=flathub \
  "$BUILD_DIR" \
  "$MANIFEST"

cat <<EOF

Done. Rommix is installed for your user.

  Run it:            flatpak run ${APP_ID}
  Run in gamescope:  gamescope -f -- flatpak run ${APP_ID}

To add it to Steam, add "flatpak run ${APP_ID}" as a non-Steam game.
EOF

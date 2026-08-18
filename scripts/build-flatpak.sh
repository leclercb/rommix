#!/usr/bin/env bash
#
# Build and install RomMix as a flatpak.
#
# Two stages: npm produces the Electron application tree, then flatpak-builder
# packages that tree. Run from the repository root.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_ID="be.bl_it.RomMix"
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

# flatpak-builder ships two ways, and the flatpak one provides no binary on
# PATH, so both have to be looked for: checking the command alone would reject a
# perfectly good install and then advise performing exactly that install.
if command -v flatpak-builder >/dev/null 2>&1; then
  FLATPAK_BUILDER=(flatpak-builder)
elif flatpak info org.flatpak.Builder >/dev/null 2>&1; then
  FLATPAK_BUILDER=(flatpak run org.flatpak.Builder)
else
  echo "error: flatpak-builder is not installed." >&2
  echo "  Install it with: flatpak install -y flathub org.flatpak.Builder" >&2
  echo "  (or your distribution's flatpak-builder package)" >&2
  exit 1
fi
echo "==> Using ${FLATPAK_BUILDER[*]}"

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
"${FLATPAK_BUILDER[@]}" \
  --force-clean \
  --user \
  --install \
  --install-deps-from=flathub \
  "$BUILD_DIR" \
  "$MANIFEST"

cat <<EOF

Done. RomMix is installed for your user.

  Run it:            flatpak run ${APP_ID}
  Run in gamescope:  gamescope -f -- flatpak run ${APP_ID}

To add it to Steam, add "flatpak run ${APP_ID}" as a non-Steam game.
EOF

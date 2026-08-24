#!/bin/sh
set -eu

APPIMAGE_EXTRACT_AND_RUN=1
export APPIMAGE_EXTRACT_AND_RUN

unset LD_PRELOAD

if [ -z "${ROMMIX_APPIMAGE-}" ]; then
  here=$(dirname "$(readlink -f "$0")")
  for candidate in "$here"/RomMix-*.AppImage; do
    [ -e "$candidate" ] || continue
    if [ -z "${ROMMIX_APPIMAGE-}" ] || [ "$candidate" -nt "$ROMMIX_APPIMAGE" ]; then
      ROMMIX_APPIMAGE=$candidate
    fi
  done
fi

if [ -z "${ROMMIX_APPIMAGE-}" ] || [ ! -e "$ROMMIX_APPIMAGE" ]; then
  echo "rommix-steam.sh: no RomMix AppImage found beside this script." >&2
  echo "  Put RomMix-x86_64.AppImage next to it, or set" >&2
  echo "  ROMMIX_APPIMAGE=/path/to/RomMix-x86_64.AppImage" >&2
  exit 1
fi

if [ ! -x "$ROMMIX_APPIMAGE" ]; then
  echo "rommix-steam.sh: $ROMMIX_APPIMAGE is not executable — chmod +x it." >&2
  exit 1
fi

exec "$ROMMIX_APPIMAGE" "$@"

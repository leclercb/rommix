#!/bin/sh
# Do not edit: RomMix replaces this file when it updates itself.
set -eu

APPIMAGE_EXTRACT_AND_RUN=1
export APPIMAGE_EXTRACT_AND_RUN

unset LD_PRELOAD

rest=$#
while [ "$rest" -gt 0 ]; do
  arg=$1
  shift
  rest=$((rest - 1))
  case $arg in
    --canary)
      ROMMIX_CANARY=1
      export ROMMIX_CANARY
      ;;
    --log=*)
      ROMMIX_LOG=${arg#--log=}
      export ROMMIX_LOG
      ;;
    --home=*)
      ROMMIX_HOME=${arg#--home=}
      export ROMMIX_HOME
      ;;
    --appimage=*)
      ROMMIX_APPIMAGE=${arg#--appimage=}
      ;;
    *)
      set -- "$@" "$arg"
      ;;
  esac
done

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
  echo "  Put RomMix-x86_64.AppImage next to it, or pass" >&2
  echo "  --appimage=/path/to/RomMix-x86_64.AppImage" >&2
  exit 1
fi

if [ ! -x "$ROMMIX_APPIMAGE" ]; then
  echo "rommix-steam.sh: $ROMMIX_APPIMAGE is not executable — chmod +x it." >&2
  exit 1
fi

exec "$ROMMIX_APPIMAGE" "$@"

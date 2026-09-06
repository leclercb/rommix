#!/bin/sh
#
# The image's entry point, sitting in front of the Electron binary.
#
# Chromium chooses its display backend in the browser process's pre-sandbox
# start-up, from XDG_SESSION_TYPE alone, before any of RomMix is loaded and
# without checking that there is a compositor of that kind to connect to. A
# gamescope session says Wayland and then keeps its compositor on a socket name
# no generic application looks for, so Chromium connects to nothing and exits
# before it draws. Nothing the application appends to its own command line can
# move that decision; only `--ozone-platform` on the real command line can, so
# it has to be decided by something running before the binary. Inside the image,
# the last thing that does is this.
#
# It belongs in the image rather than in packaging/rommix-steam.sh because the
# image is the file an update is sure of. The script beside it is brought back
# into step as well — `Updater.refreshLauncher` in src/main/update.ts — but only
# where a copy is already there, only once the new version has started, and
# never at the cost of a start-up, which makes it the weaker of the two places
# to put anything.
#
# So that script carries what has to happen before the AppImage runtime starts
# and nothing else: a line added there reaches a machine late, or never. It
# explains none of this itself — the copy beside the image is the user's, and
# the one line it carries is addressed to them — so the reasoning for both
# files is here.
#
# See scripts/after-pack.mjs, which puts this where AppRun looks for `rommix`.
set -eu

# Only where there is an X server to fall back to. A Wayland session with no
# Xwayland has nothing better to offer, and naming x11 there trades a backend
# that cannot connect for another one that cannot either — with the difference
# that the second is our doing and reads as a bug in RomMix.
if [ "${XDG_SESSION_TYPE-}" = wayland ] && [ -n "${DISPLAY-}" ]; then
  socket=${WAYLAND_DISPLAY:-wayland-0}
  case $socket in
    /*) ;;
    *) socket="${XDG_RUNTIME_DIR-}/$socket" ;;
  esac
  case " $* " in
    # An explicit choice is left alone: whoever passed one meant it, and this
    # is the switch the README tells people to reach for.
    *" --ozone-platform="*) ;;
    *) [ -e "$socket" ] || set -- --ozone-platform=x11 "$@" ;;
  esac
fi

exec "$(dirname "$(readlink -f "$0")")/rommix.bin" "$@"

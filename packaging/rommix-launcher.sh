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
# into step as well — `Updater.refreshSteamLauncher` in src/main/update.ts — but only
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

# -- which backend ------------------------------------------------------------

# The socket Chromium would connect to, worked out the way Chromium works it
# out: WAYLAND_DISPLAY, or `wayland-0` under XDG_RUNTIME_DIR where that is
# unset. Computed whatever the session says, so the note below can report it
# either way.
socket=${WAYLAND_DISPLAY:-wayland-0}
case $socket in
  /*) ;;
  *) socket="${XDG_RUNTIME_DIR-}/$socket" ;;
esac

case " $* " in
  # An explicit choice is left alone, whatever the session says: whoever passed
  # one meant it, and this is the switch the README tells people to reach for.
  # Asked first so that the record below names the reason that actually
  # decided — the file exists to have its decision disagreed with.
  *" --ozone-platform="*)
    chose="a backend was named on the command line"
    ;;
  *)
    if [ "${XDG_SESSION_TYPE-}" != wayland ]; then
      chose="the session does not say wayland, so Chromium chooses for itself"
    elif [ -e "$socket" ]; then
      chose="a wayland session with a compositor where Chromium will look"
    elif [ -n "${DISPLAY-}" ]; then
      # Only where there is an X server to fall back to. A wayland session with
      # no Xwayland has nothing better to offer, and naming x11 there trades a
      # backend that cannot connect for another one that cannot either — with
      # the difference that the second is our doing and reads as a bug in
      # RomMix.
      set -- --ozone-platform=x11 "$@"
      chose="a wayland session with no compositor there, falling back to X11"
    else
      chose="a wayland session with no compositor there, and no DISPLAY to fall back to"
    fi
    ;;
esac

# -- saying so ----------------------------------------------------------------
#
# The decision is made before the binary runs, so nothing inside RomMix can
# record it — and a session where the fallback declines is one where RomMix
# never starts, writes no line of its own, and looks from the outside exactly
# like one where it fell back and X11 refused it too. Those are different
# faults, and the log folder is where somebody is asked to look for the
# difference.
#
# Its own file rather than a line in `rommix.log`: `rotate` in src/main/log.ts
# reads the day off that file's own last write, so an append from out here would
# stamp it with today on every start and the daily rollover would never happen
# again.
#
# A line per launch, kept, because the question asked of this file is rarely
# about one launch on its own — it is "it worked yesterday", "it works from the
# desktop and not from Steam", "it started three times out of four". A single
# record answers none of those; two lines that disagree answer all three.

# How many lines it keeps, which is how many launches: a launch writes one line,
# and `quoted` takes the control characters out of every value in it, so nothing
# a record carries can become a second record.
#
# Enough to cover the gap between something breaking and somebody being asked
# for the file, and to hold both sides of a machine that is started from two
# places — and small enough that a handheld launched twice a day for years never
# notices the file.
KEEP=200

# Handed the command line as it now stands, ours included: inside a function
# `"$@"` is the function's own arguments and the script's are out of reach.
note() {
  # What this line is for, beyond the branch above: a start-up that fails leaves
  # nothing else anywhere, so this is the whole account of every launch that
  # never became a running RomMix — not only the ones that fail on the display.
  #
  # Three groups, each answering a question the reports here actually ask.
  #
  # What is running: the version, which a bug report needs and which nothing
  # else can give when the application never starts; and the kernel and machine,
  # which is where "no such loader" and a missing system library begin.
  #
  # What the session is, which is what the branch above was decided on, so the
  # decision can be disagreed with.
  #
  # How it was started: `LD_PRELOAD` still holding Steam's overlay and
  # `APPIMAGE_EXTRACT_AND_RUN` unset are what a launch that went around
  # `rommix-steam.sh` looks like; `APPDIR` says the image mounted and where;
  # `HOME` decides which folder this very line was written to, which under Steam
  # is not always the one the desktop uses; and the switches are the command
  # line actually handed on, which is where `--no-sandbox` shows up — AppRun
  # adds it on a machine with no user namespaces, and that changes how Chromium
  # starts.
  #
  # Named variables rather than the environment entire, and switches rather than
  # every argument. The log is what a bug report carries and RomMix strips
  # credentials on the way into it — see `scrub` in src/main/log.ts — which a
  # dump of everything would quietly undo. `PATH` and `LD_LIBRARY_PATH` are left
  # out for a duller reason: both are long, both differ on every machine, and
  # nothing decided here depends on either.
  #
  # Control characters go with the quotes and backslashes: this is one record on
  # one line, and a newline in a value would be a second line that reads as a
  # second launch.
  quoted() {
    printf '%s' "${1-}" | tr -d '[:cntrl:]' | sed 's/[\\"]/\\&/g'
  }

  # The version the image was built as. Read off the desktop entry beside this
  # script, which is where electron-builder writes it — the application's own
  # copy is inside `app.asar`, which nothing out here can open.
  version=
  if [ -n "${APPDIR-}" ]; then
    version=$(sed -n 's/^X-AppImage-Version=//p' "$APPDIR"/*.desktop 2>/dev/null | head -n 1)
  fi

  # The switches this hands on, ours included. Operands are left out rather than
  # filtered: the desktop entry passes `%U`, so a bare argument can be a URL
  # somebody was opened into, and a URL is the one thing here that can carry a
  # token.
  switches=
  for arg in "$@"; do
    case $arg in
      --*) switches="$switches $arg" ;;
    esac
  done

  detail=$(
    printf '{"version":"%s","system":"%s"' \
      "$(quoted "$version")" \
      "$(quoted "$(uname -srm 2>/dev/null)")"
    printf ',"session":"%s","desktop":"%s","display":"%s","waylandDisplay":"%s"' \
      "$(quoted "${XDG_SESSION_TYPE-}")" \
      "$(quoted "${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION-}}")" \
      "$(quoted "${DISPLAY-}")" \
      "$(quoted "${WAYLAND_DISPLAY-}")"
    printf ',"socket":"%s","gamescope":"%s","ozoneHint":"%s"' \
      "$(quoted "$socket")" \
      "$(quoted "${GAMESCOPE_WAYLAND_DISPLAY-}")" \
      "$(quoted "${ELECTRON_OZONE_PLATFORM_HINT-}")"
    printf ',"steam":"%s","home":"%s","appImage":"%s","appDir":"%s"' \
      "$(quoted "${SteamGameId-${SteamAppId-}}")" \
      "$(quoted "${HOME-}")" \
      "$(quoted "${APPIMAGE-}")" \
      "$(quoted "${APPDIR-}")"
    printf ',"extractAndRun":"%s","ldPreload":"%s","switches":"%s"}' \
      "$(quoted "${APPIMAGE_EXTRACT_AND_RUN-}")" \
      "$(quoted "${LD_PRELOAD-}")" \
      "$(quoted "${switches# }")"
  )

  # The shape `format` in src/main/log.ts writes, so a line pasted beside the
  # ones from `rommix.log` reads as one of them. Seconds rather than
  # milliseconds: the fractional format is a GNU extension, and a stamp that
  # printed `%3N` on a system without it would be worse than a coarser one.
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) INFO  startup    $chose $detail"

  # The console first, because it needs nothing of RomMix's: a machine with no
  # root to write to, or none this script can find, is still a machine somebody
  # may be watching a terminal on. Under Steam this is `console-linux.txt`,
  # which is where the errors this line explains turn up.
  printf '%s\n' "$line" >&2 || true

  # `ROMMIX_LOG=off` silences the file as it silences the log itself. The same
  # answer `configuredLevel` in src/main/log.ts gives for the same input:
  # trimmed, lowercased, anything unrecognised meaning info. An info line is
  # written where that level is debug or info, and nowhere else.
  case $(printf '%s' "${ROMMIX_LOG-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]') in
    off | none | warn | error) return 0 ;;
  esac

  # Where RomMix keeps its log, resolved the way `resolveRoot` in
  # src/main/root.ts resolves it: ROMMIX_HOME, then the pointer file beside the
  # desktop's configuration, then ~/rommix. Trimmed at both ends as that does,
  # since a variable set to a space is a variable somebody meant to leave unset.
  trim() {
    printf '%s' "${1-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
  }

  root=$(trim "${ROMMIX_HOME-}")
  if [ -z "$root" ]; then
    # No home is no default root either. `resolveRoot` falls back to the passwd
    # entry there, which nothing out here can read — and guessing `/rommix`
    # instead would be a folder in the root of the disk, refused on every
    # ordinary machine and complained about on every launch.
    [ -n "${HOME-}" ] || return 0
    pointer="${XDG_CONFIG_HOME:-$HOME/.config}/rommix/root"
    if [ -r "$pointer" ]; then
      # `|| true` rather than a test on the read: a pointer written without a
      # trailing newline still hands back the path it holds and then reports
      # the end of the file, and that path is the answer.
      IFS= read -r pointed < "$pointer" || true
      root=$(trim "${pointed-}")
    fi
    [ -n "$root" ] || root="$HOME/rommix"
  fi
  # Absolute or nothing. A relative one would put a `logs` folder wherever this
  # script happened to be started from, which is neither RomMix's nor findable.
  case $root in
    /*) ;;
    *) return 0 ;;
  esac

  # Silenced, all of it. A root on a disk that is not mounted, or a `logs`
  # folder somebody else owns, is a launch that says "Permission denied" three
  # times on its way past — noise on a console this script exists to keep
  # readable, and about a file nobody asked it to write.
  mkdir -p "$root/logs" 2>/dev/null || return 0
  log="$root/logs/launcher.log"
  printf '%s\n' "$line" 2>/dev/null >> "$log" || return 0

  # Trimmed only once it is over the cap, and through a name this process alone
  # writes: two launches sharing one `.part` would each truncate what the other
  # was filling, and the history they were both keeping would end up empty. The
  # append above is atomic, and the worst a lost race can cost now is the couple
  # of lines added between one launcher reading the file and renaming it back.
  # Counted defensively: a `wc` that is missing or a file that has gone hands
  # back nothing, and `[ -gt ]` on nothing is an error message rather than a
  # comparison.
  lines=$(wc -l < "$log" 2>/dev/null) || lines=0
  [ -n "$lines" ] || lines=0
  if [ "$lines" -gt "$KEEP" ]; then
    part="$log.$$"
    if tail -n "$KEEP" "$log" 2>/dev/null > "$part"; then
      mv -f "$part" "$log" 2>/dev/null || true
    fi
    rm -f "$part" 2>/dev/null || true
  fi
}

# Two things stand between the record and a launch it could cost.
#
# It is tested, so `set -e` stands down inside it: a missing `date`, a `sed`
# that is not there, a root that cannot be written — none of those is worth a
# RomMix that does not start.
#
# And SIGPIPE is ignored across it, because a status test never sees a signal: a
# console whose reader has gone would otherwise end the shell on the write, or
# on any diagnostic the shell itself makes afterwards. Put back immediately
# below, so the binary starts with the disposition it expects.
trap '' PIPE
note "$@" || true
trap - PIPE

exec "$(dirname "$(readlink -f "$0")")/rommix.bin" "$@"

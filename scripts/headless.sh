#!/usr/bin/env bash
#
# Run a command that drives Electron, the same way everywhere.
#
# Two things stand between a checkout and any of those: an Electron this machine
# can execute, and a screen to draw on. A headless runner has neither, and
# without this each caller would carry the same two workarounds — `xvfb-run`
# around the command, and on NixOS an `ELECTRON_EXEC_PATH` pointing somewhere
# the npm download is not.
#
# A desktop has both, and the screen it has is the wrong one: see `on_desktop`.
# So the screen is this script's either way, and a suite that passes here passes
# on the runner for the same reasons.
#
# Both callers need both. `test:app` drives a real window through the DevTools
# protocol; `screenshots` renders off screen and still needs a display to do it,
# Electron on Linux having nothing to initialise a GPU process against without
# one. So there is no flag here for wanting one and not the other.
#
# Nothing is installed. What is missing is borrowed from nixpkgs for the length
# of the run, which is also why nix is only asked for when something is actually
# missing: a machine that has what it needs never learns this script can do that.
#
# Not for `npm run dev`, which also starts Electron. That opens a window
# somebody is going to look at, and the whole business below ends by putting the
# window somewhere nobody can see it. What it wants from here is the binary
# alone, which `.envrc` already gives it.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/headless.sh <command> [args...]" >&2
  exit 64
fi

# The Electron the command will start, or nothing where there is none this
# machine can run. `--version` rather than a test for the file: on NixOS the
# binary `npm install` downloads is there and cannot be executed at all, there
# being no loader at the path it is linked against, and only running it says so.
usable_electron() {
  local candidate
  for candidate in "${ELECTRON_EXEC_PATH-}" "$(command -v electron || true)" \
    node_modules/electron/dist/electron; do
    if [ -n "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

# A screen of this script's own, rather than the desktop's.
#
# Nothing here looks at the window — the suite drives it through the DevTools
# protocol — and a window on somebody's desktop is drawn under that desktop's
# rules: Chromium throttles rendering for a window that is occluded or not
# focused, the compositor decides when a frame lands, and another application
# can take the focus mid-run. Each of those arrives as a screen that is late
# rather than wrong, which is a test that fails on a machine and passes on the
# next. So the window is drawn where none of that reaches it, and the run is
# the same one CI makes.
#
# `ROMMIX_ON_DISPLAY=1` puts it back on the desktop, for the one case this
# cannot serve: watching what the suite is doing to a window that will not
# behave. `npm run dev` is the way to look at the application itself.
on_desktop() {
  [ -n "${ROMMIX_ON_DISPLAY-}" ] && [ -n "${DISPLAY-}${WAYLAND_DISPLAY-}" ]
}

# Asked for once, up front, so the run happens inside a single shell rather than
# one per missing piece. Re-entered rather than nested: the checks below then
# answer the same way for the same reasons, against what the shell now provides.
if [ -z "${ROMMIX_HEADLESS_PROVISIONED-}" ]; then
  wanted=()
  usable_electron >/dev/null || wanted+=(nixpkgs#electron)
  # Both, because they are two packages: `xvfb-run` is a shell script and the X
  # server it starts is not in it. A distribution ships them together and this
  # asks for neither; a profile with only the wrapper in it would otherwise get
  # as far as starting a server that is not there.
  if ! on_desktop && { ! command -v xvfb-run || ! command -v Xvfb; } >/dev/null 2>&1; then
    wanted+=(nixpkgs#xvfb-run nixpkgs#xorg.xorgserver)
  fi

  if [ ${#wanted[@]} -gt 0 ]; then
    if ! command -v nix >/dev/null 2>&1; then
      echo "This needs ${wanted[*]}, and there is no nix here to borrow them from." >&2
      echo "  Install Electron with 'npx install-electron', and Xvfb from your" >&2
      echo "  distribution, or run this on a machine with a display." >&2
      exit 1
    fi
    echo "==> Borrowing ${wanted[*]} for this run"
    exec nix shell "${wanted[@]}" --command env ROMMIX_HEADLESS_PROVISIONED=1 "$0" "$@"
  fi
fi

# The variable electron-vite reads to find the binary, and the one the app
# driver reads before falling back to `node_modules` — the same one `.envrc`
# sets, for the same reason. Named explicitly rather than left to either of them
# to guess, so a build and the thing that runs it use the same Electron.
ELECTRON_EXEC_PATH=$(usable_electron)
export ELECTRON_EXEC_PATH

# And on PATH, ahead of everything, for the caller that says plain `electron`.
# npm puts `node_modules/.bin` in front for the length of a script, so a command
# borrowed from nixpkgs would otherwise be passed over for the download beside
# it — which on the machine that needed borrowing is the one that cannot run.
PATH="$(cd "$(dirname "$ELECTRON_EXEC_PATH")" && pwd):$PATH"
export PATH

# Electron-based tooling exports this, and a child Electron inherits it: the
# application would start as plain Node, exit without a window, and report no
# error. The same line `.envrc` carries.
unset ELECTRON_RUN_AS_NODE

# The screen size is not incidental. The stylesheet is written for a 1080p
# television, and on a smaller screen the library's games are drawn below the
# fold of a window too small to hold them, where they are focusable and
# invisible — which reads as a focus engine that has stopped working, and
# photographs as a landing page missing the shelf it is there to show.
#
# `-a` is not decoration either. Without it `xvfb-run` always takes display :99,
# and where something already holds that one its own server exits on the spot:
# the command then runs on a screen it did not start, and the wrapper's cleanup
# kills a process that has gone and returns *that* status rather than the
# command's — a green run reported as a failure, in the one place that decides
# whether a tag is cut.
if on_desktop; then
  echo "==> Drawing on this desktop, as ROMMIX_ON_DISPLAY asks"
  window=()
else
  # Xvfb is an X server, and Electron does not look for one in a Wayland
  # session: it takes the backend from `XDG_SESSION_TYPE`, and the hint
  # variable overrides even that. Left alone, the window opens on the desktop
  # compositor at the desktop's size and scale, and Xvfb sits there unused.
  window=(
    env -u WAYLAND_DISPLAY -u ELECTRON_OZONE_PLATFORM_HINT XDG_SESSION_TYPE=x11
    xvfb-run -a --server-args="-screen 0 1920x1080x24"
  )
fi

exec "${window[@]}" "$@"

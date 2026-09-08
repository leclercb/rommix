#!/usr/bin/env bash
#
# `npm run test:app` on NixOS.
#
# Neither half of what that suite needs is on such a machine. The Electron
# `npm install` downloads cannot be executed at all — there is no loader at the
# path they are linked against — and a headless host has no X server. Both come
# out of nixpkgs for the length of the run, so nothing is installed and nothing
# is left behind. It has to be a real X server: Electron ships no headless
# Chromium, and `--ozone-platform=headless` never brings a window up.
#
# `-a` is not decoration. Without it `xvfb-run` always takes display :99, and
# where something already holds that one its own Xvfb exits on the spot — the
# suite then runs on a screen it did not start, and the wrapper's cleanup kills
# a process that has gone and returns *that* status rather than the suite's, so
# a run where nothing failed reports failure.
#
# `ELECTRON_EXEC_PATH` is the variable `.envrc` sets and is here for the same
# reason; it is set inside the shell because that is the only place the binary
# exists. What nixpkgs packages is whatever Electron major it has, which is not
# necessarily the one in `package.json` — what the suite drives is the DevTools
# protocol, and the four messages it sends predate any of them.
#
# `ELECTRON_RUN_AS_NODE` goes for the reason `.envrc` unsets it: Electron-based
# tooling exports it, a child Electron inherits it, and the application then
# starts as plain Node, exits without a window, and reports no error.
#
# The screen size is not incidental either. The stylesheet is written for a
# 1080p television, and on a smaller screen the library's games are drawn below
# the fold of a window too small to hold them. See CONTRIBUTING.
set -euo pipefail

cd "$(dirname "$0")/.."

exec nix shell nixpkgs#electron nixpkgs#xvfb-run nixpkgs#xorg.xorgserver --command bash -c '
  unset ELECTRON_RUN_AS_NODE
  export ELECTRON_EXEC_PATH=$(command -v electron)
  exec xvfb-run -a --server-args="-screen 0 1920x1080x24" npm run test:app
'

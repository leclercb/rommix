#!/usr/bin/env bash
#
# `npm run test:app`: the built application, driven from outside against a fake
# RomM.
#
# What the suite needs that a headless runner has not got — an Electron it can
# execute, and a screen to draw on — is `scripts/headless.sh`, which every
# command here that starts Electron goes through. That is why `npm run release`
# can run this suite before it tags anything, from a machine with no display and
# no ceremony.
set -euo pipefail

cd "$(dirname "$0")/.."

# Built outside the window, because bundling needs none — and outside the
# borrowing too: `electron-vite build` writes bundles and starts no Electron, so
# it is the one step here that a machine which cannot run one still completes.
npm run build

# A backstop, not a budget. Node's own default is `Infinity`, so anything that
# gets stuck below the driver's own waits — a debugger that never answers, an
# emulator stand-in that will not close — is a run that hangs until the CI job
# is cancelled, with no screenshot and no message. Generously above the longest
# scenario, which is the one that runs an emulator.
TEST_TIMEOUT_MS=${TEST_TIMEOUT_MS:-300000}

# One file at a time on purpose. There is a real window being driven, and a
# second suite competing for the machine changes how long a list takes to draw.
#
# Two warnings are turned off by name rather than left to be read past. The
# experimental one is about `--experimental-transform-types` below, which is
# asked for deliberately and is the only experimental thing here. The
# typeless one asks for `"type": "module"` in package.json, which is not a
# choice this suite gets to make: the same field decides the format the
# application is built in, and a preload cannot be an ES module while the
# renderer that loads it is sandboxed — see `sandbox` in src/main/app.ts.
exec ./scripts/headless.sh node \
  --import ./scripts/test-resolve.mjs \
  --experimental-transform-types \
  --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --test \
  --test-concurrency=1 \
  --test-timeout="$TEST_TIMEOUT_MS" \
  "test/app/**/*.test.ts"

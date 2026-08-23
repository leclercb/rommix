#!/usr/bin/env bash
#
# Assemble the public site into out/site.
#
# Two halves, and neither is part of the application: the landing page in
# `site/`, copied as it is, and the browser build of the renderer in `demo/`,
# which is `npm run preview:app` with a stub library behind it rather than a
# RomM server. `.github/workflows/pages.yml` runs this and uploads the result,
# so what is published is what this produces here.
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="out/site"

echo "==> Building the web preview"
# Writes $OUT/demo, per `build.outDir` in the config.
npx vite build --config vite.web.config.ts

echo "==> Copying the landing page"
mkdir -p "$OUT"
cp -R site/. "$OUT/"

cat <<EOF

Done. The site is in $OUT.

  Look at it:  npm run preview:web
               (or any static server on $OUT — the demo needs no backend)
EOF

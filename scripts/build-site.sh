#!/usr/bin/env bash
#
# Assemble the public site into out/site.
#
# Two halves, and neither is part of the application: the landing page in
# `site/`, rendered once per language, and the browser build of the renderer in
# `demo/`, which is `npm run preview:app` with a stub library behind it rather
# than a RomM server. `.github/workflows/pages.yml` runs this and uploads the
# result, so what is published is what this produces here.
#
# The demo is built once and picks its language in the browser; the landing page
# is four static documents, so that each language is a URL a search engine can
# index and offer — which is what the `hreflang` links between them are for.
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="out/site"

echo "==> Building the web preview"
# Writes $OUT/demo, per `build.outDir` in the config.
npx vite build --config vite.web.config.ts

echo "==> Rendering the landing page"
mkdir -p "$OUT"

# The pictures of the interface, shared by all four languages — `{{root}}` puts
# every page's link to them at the top of the site. Taken by
# `npm run screenshots`, and committed, so building the site needs no display.
#
# Replaced rather than copied into: `cp` of a directory onto one that exists
# nests it, and the second build of the day would put the pictures in
# `img/img/` while the pages went on asking for `img/`.
rm -rf "$OUT/img"
cp -r site/img "$OUT/img"
# `--experimental-transform-types` so it can read the application's own
# catalogue: the picture on the page is a drawing of RomMix, and its labels come
# from what RomMix actually says. Nothing is bundled: the two short scripts the
# page runs are inline in the template — see `scripts/build-landing.mjs`.
node --experimental-transform-types --no-warnings scripts/build-landing.mjs

cat <<EOF

Done. The site is in $OUT.

  Look at it:  npm run preview:web
               (or any static server on $OUT — the demo needs no backend)
EOF

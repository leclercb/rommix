import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Drop the app's Content-Security-Policy from the page, while serving it.
 *
 * `src/renderer/index.html` declares `script-src 'self'`, which is right for the
 * shipped app and fatal under `vite dev`: the hot-reload preamble is an inline
 * script, so that policy makes the browser refuse it and the page never renders.
 * The meta tag in the file is left exactly as it is — this rewrites only what
 * this config serves.
 *
 * `apply: 'serve'` because a built bundle has no inline script in it, so the
 * demo published to GitHub Pages keeps the same policy the app ships with.
 */
function withoutCsp(): Plugin {
  return {
    name: 'rommix:preview-without-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
  }
}

/**
 * Say in the page itself that this is the demo, not the app.
 *
 * The published copy is reachable directly, so someone can arrive at a
 * convincing library without having read a word of the landing page beside it.
 * The tab is the one label that follows the page wherever it is linked from, and
 * the description says the same thing to anything that unfurls the link.
 *
 * `src/renderer/index.html` is left alone: the app is not the demo, and this is
 * the only build that is.
 */
function demoLabels(): Plugin {
  return {
    name: 'rommix:preview-labels',
    transformIndexHtml: (html) =>
      html.replace(
        '<title>RomMix</title>',
        '<title>RomMix — demo</title>\n' +
          // No viewport tag on purpose: this is a ten-foot interface, and a
          // phone showing the whole layout scaled down beats one showing a
          // corner of it at full size.
          '    <meta name="description" content="The RomMix interface, running against ' +
          'the homebrew library from RomM&#39;s public demo. No server and no emulator ' +
          'are involved, and nothing is downloaded." />\n' +
          '    <meta name="robots" content="noindex" />'
      )
  }
}

/**
 * The renderer on its own, in a browser — `npm run preview:web` to look at it
 * here, `npm run build:site` to produce the copy published on GitHub Pages.
 *
 * Serving it is for looking at the front end on a machine with no compositor: a
 * headless server, or a session where starting Electron is not worth it.
 * Building it is the public demo, which is the same thing with the same stub
 * behind it. Nothing here builds anything shipped; `electron.vite.config.ts`
 * remains the only config the app itself is built with, and this one
 * deliberately duplicates its renderer section rather than importing it, since
 * electron-vite's nested shape is not something plain Vite can consume.
 *
 * There is no preload script in a browser and so no `window.rommix`. The flag
 * below is what makes `main.tsx` install the stub in `src/renderer/src/dev/`
 * before anything renders; in every other build it is undefined, and the import
 * is dropped along with the branch.
 */
export default defineConfig({
  root: 'src/renderer',
  /**
   * Relative, so the built demo does not have to be told where it is hosted.
   * It is served from a subdirectory of a project page —
   * `leclercb.github.io/rommix/demo/` — and there is no router to confuse:
   * every screen is a state of one document.
   */
  base: './',
  /**
   * The demo library's cover art, copied beside the page rather than imported.
   *
   * It has to be outside `src/renderer` — anything the renderer imports is
   * emitted into the *application* build too, because Vite writes an asset out
   * while transforming the module that references it, whether or not the branch
   * importing that module survives. 2.8 MB of homebrew covers in the flatpak is
   * a poor trade for a demo page, so `library.ts` names these by URL and only
   * this config knows where they are.
   */
  publicDir: resolve('demo'),
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@config': resolve('src/config')
    }
  },
  plugins: [react(), withoutCsp(), demoLabels()],
  define: { 'import.meta.env.VITE_WEB_PREVIEW': 'true' },
  // Beside the landing page rather than under it: `scripts/build-site.sh`
  // assembles both halves of the site into `out/site`, which is what the Pages
  // workflow uploads.
  build: { outDir: resolve('out/site/demo'), emptyOutDir: true },
  // Reachable from another machine, this being the whole point on a host with
  // no desktop of its own.
  server: { host: true, port: 5273 }
})

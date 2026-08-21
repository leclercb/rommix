import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Drop the app's Content-Security-Policy from the page, for the preview only.
 *
 * `src/renderer/index.html` declares `script-src 'self'`, which is right for the
 * shipped app and fatal here: Vite's hot-reload preamble is an inline script, so
 * under that policy the browser refuses it and the page never renders. The meta
 * tag in the file is left exactly as it is — this rewrites only what this config
 * serves.
 */
function withoutCsp(): Plugin {
  return {
    name: 'rommix:preview-without-csp',
    transformIndexHtml: (html) =>
      html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
  }
}

/**
 * The renderer on its own, in a browser — `npm run preview:web`.
 *
 * For looking at the front end on a machine with no compositor: a headless
 * server, or a session where starting Electron is not worth it. Nothing here
 * builds anything shipped; `electron.vite.config.ts` remains the only config the
 * app itself is built with, and this one deliberately duplicates its renderer
 * section rather than importing it, since electron-vite's nested shape is not
 * something plain Vite can consume.
 *
 * There is no preload script in a browser and so no `window.rommix`. The flag
 * below is what makes `main.tsx` install the stub in `src/renderer/src/dev/`
 * before anything renders; in every other build it is undefined, and the import
 * is dropped along with the branch.
 */
export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@config': resolve('src/config')
    }
  },
  plugins: [react(), withoutCsp()],
  define: { 'import.meta.env.VITE_WEB_PREVIEW': 'true' },
  // Reachable from another machine, this being the whole point on a host with
  // no desktop of its own.
  server: { host: true, port: 5273 }
})

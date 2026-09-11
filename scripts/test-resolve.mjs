/**
 * Module resolution for `npm test`.
 *
 * Two things the bundler does that Node does not, supplied here so that main-
 * process code can be unit-tested by `node --test` rather than only by running
 * the application:
 *
 *  - the `@shared/…` and `@config/…` aliases the tsconfigs declare. Node's own
 *    subpath imports would work, but they must begin with `#`, and renaming the
 *    aliases across the app to suit the test runner is the tail wagging the dog.
 *  - a stand-in for `electron`, which is not a module that can be imported
 *    outside an Electron process at all. Only the handful of names the main
 *    process reaches for at *import* time are provided; anything a test actually
 *    calls throws, loudly and by name, rather than quietly answering wrong.
 *  - JSX. Node's own type stripping reads TypeScript and refuses `.tsx`, which
 *    is why the renderer's pure logic has been moved out into `.ts` modules to
 *    be tested at all — see `geometry.ts` and `history.ts`. What that cannot
 *    reach is a component, and the focus engine *is* one: what it costs to
 *    press a direction is a question about rendering. esbuild is already here
 *    for the bundler and answers in a millisecond a file.
 *
 * Registered with `module.registerHooks`, which is synchronous and in-thread —
 * so it needs no worker, and a resolution failure surfaces as an ordinary stack
 * rather than as a loader crash.
 */
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve as resolvePath } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const ALIASES = {
  '@shared/': resolvePath(import.meta.dirname, '..', 'src', 'shared'),
  '@config/': resolvePath(import.meta.dirname, '..', 'src', 'config')
}

/** The stub's own URL, so `load` below can recognise a request for it. */
const ELECTRON_STUB = 'rommix-test:electron'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { url: ELECTRON_STUB, shortCircuit: true }
    }

    for (const [prefix, dir] of Object.entries(ALIASES)) {
      if (!specifier.startsWith(prefix)) continue
      // The aliases are written the way a bundler takes them: no extension, and
      // a directory standing for the `index.ts` inside it — `@config/emulators`
      // is a folder, `@config/systems` is a file.
      const base = resolvePath(dir, specifier.slice(prefix.length))
      const target = base.endsWith('.ts')
        ? base
        : existsSync(`${base}.ts`)
          ? `${base}.ts`
          : resolvePath(base, 'index.ts')
      return { url: pathToFileURL(target).href, shortCircuit: true }
    }

    /**
     * A relative import with no extension on it, which is how the renderer is
     * written.
     *
     * `src/main/` carries an explicit `.ts` on every relative import precisely
     * so the test runner can resolve it — see CONTRIBUTING. The renderer never
     * had to: Vite resolves its own graph, and nothing out here ever loaded one
     * of those files. Now that a component can be rendered in a test, the
     * bundler's rule has to be spelled out, and this is it — the file itself
     * first, then the folder standing for the `index` inside it.
     */
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const from = resolvePath(fileURLToPath(context.parentURL ?? import.meta.url), '..')
      const base = resolvePath(from, specifier)
      const candidates = [
        `${base}.tsx`,
        `${base}.ts`,
        resolvePath(base, 'index.tsx'),
        resolvePath(base, 'index.ts')
      ]
      const target = candidates.find((candidate) => existsSync(candidate))
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true }
    }

    return nextResolve(specifier, context)
  },

  load(url, context, nextLoad) {
    /**
     * JSX, compiled on the way in.
     *
     * `automatic` rather than the classic transform, so a component file needs
     * no `import React` it would not otherwise have — which is how the
     * application's own files are written, and the point is to run those rather
     * than a variant of them. Types are stripped in the same pass; Node's
     * `--experimental-transform-types` never sees these files.
     */
    if (url.startsWith('file:') && url.endsWith('.tsx')) {
      const path = fileURLToPath(url)
      const { code } = transformSync(readFileSync(path, 'utf8'), {
        loader: 'tsx',
        jsx: 'automatic',
        format: 'esm',
        target: 'node24',
        sourcefile: path
      })
      return { format: 'module', shortCircuit: true, source: code }
    }

    if (url !== ELECTRON_STUB) return nextLoad(url, context)
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        const refuse = (name) => () => {
          throw new Error(
            'electron.' + name + ' was called in a unit test. ' +
            'scripts/test-resolve.mjs stubs electron so pure helpers can be imported; ' +
            'anything that genuinely drives Electron belongs in the app, not here.'
          )
        }
        // Enough to satisfy an import. Every one of these throws when used —
        // except \`isReady\`, which answers, because it is the one question that
        // has a true answer out here: no Electron app is running, so \`i18n()\`
        // falls back to English instead of asking for the desktop's locale.
        // Without it every message the main process throws is a TypeError from
        // inside the translator rather than the sentence under test.
        export const app = {
          isReady: () => false,
          getVersion: refuse('app.getVersion'),
          getLocale: refuse('app.getLocale'),
          on: refuse('app.on')
        }
        export const safeStorage = {
          isEncryptionAvailable: refuse('safeStorage.isEncryptionAvailable'),
          encryptString: refuse('safeStorage.encryptString'),
          decryptString: refuse('safeStorage.decryptString')
        }
        export const ipcMain = { handle: refuse('ipcMain.handle') }
        export const shell = { openExternal: refuse('shell.openExternal') }
        export const BrowserWindow = class { constructor() { refuse('BrowserWindow')() } }
        export const protocol = { handle: refuse('protocol.handle') }
        export const screen = { on: refuse('screen.on') }
        export default { app, safeStorage, ipcMain, shell, BrowserWindow, protocol, screen }
      `
    }
  }
})

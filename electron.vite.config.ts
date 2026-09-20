import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * The commit this bundle is built from, stamped into the main process.
 *
 * Every build between two releases carries the same version — package.json is
 * bumped when a release is cut and not before — so a version cannot tell one
 * build of `main` from the next. The commit can, and the canary channel is
 * built on exactly that comparison: see `BUILD_COMMIT` in src/main/update.ts.
 *
 * Empty where there is no history to ask: a source tarball, or a checkout with
 * no `.git`. The canary check refuses by name there rather than guessing.
 */
function buildCommit(): string {
  const git = (args: string[]): string =>
    execFileSync('git', args, {
      encoding: 'utf8',
      // A build outside a repository is an ordinary thing and not a warning:
      // git's own complaint on the way past would be the only sign of trouble
      // in an output that has none.
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()

  try {
    const head = git(['rev-parse', 'HEAD'])
    // The working tree counts. A stamp taken from the commit alone names one
    // this build is not the moment anything is uncommitted — and the build
    // that happens to is the one handed to somebody to try, which comes back
    // as a report against code that never held the fault.
    //
    // Tracked files only. An untracked one is a build artifact, a cache or an
    // editor's leavings far more often than it is source, and a runner that
    // picks one up would otherwise publish every image with a suffix. What
    // that costs is in `runningCommit`, which is why it is not risked for the
    // sake of the rare untracked file that is genuinely compiled in.
    return git(['status', '--porcelain', '--untracked-files=no']) ? `${head}-dirty` : head
  } catch {
    return ''
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // The main process alone: nothing the renderer draws is decided by which
    // commit built it, and a constant in the bundle the browser loads is one
    // more thing the web preview would have to be told about.
    define: { BUILD_COMMIT: JSON.stringify(buildCommit()) },
    resolve: {
      alias: { '@shared': resolve('src/shared'), '@config': resolve('src/config') }
    },
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@config': resolve('src/config')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
})

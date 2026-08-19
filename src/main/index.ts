import { BrowserWindow, app, protocol } from 'electron'
import { IMAGE_SCHEME, RomMixApp } from './app'
import { registerIpc } from './ipc'
import { ensureRoot } from './root'

/** RomMix main process bootstrap. */

// The root has to exist before the Store reads from it. Electron's own userData
// is deliberately left alone: it holds Chromium's caches, cookies, GPU state and
// singleton locks, none of which belong in a folder meant to hold the handful of
// files RomMix itself writes.
ensureRoot()

// Must run before `app.ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true }
  }
])

/**
 * Steam Big Picture and gamescope hand us a bare fullscreen surface. Hinting
 * Ozone at the native platform keeps us on Wayland under gamescope — where the
 * X11 fallback causes scaling and controller-focus quirks — while still working
 * in a normal desktop session.
 *
 * `ozone-platform-hint` is set here for completeness only. Chromium chooses its
 * backend during early start-up, before any of this runs, so a packaged build
 * that relies on this line alone takes X11 and exits on a Wayland-only session.
 * What actually decides it is `ELECTRON_OZONE_PLATFORM_HINT`, set by the
 * launcher — the flatpak manifest, or nixpkgs' own Electron wrapper in
 * development, which is why this was invisible until the first flatpak run.
 */
function applyDisplayFlags(): void {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
  app.commandLine.appendSwitch('enable-smooth-scrolling')
}

// Before the single-instance lock, which starts enough of the browser process
// that later switches are read too late to matter.
applyDisplayFlags()

// Only one instance may own the ROM tree and the download queue.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const rommix = new RomMixApp()

  void app.whenReady().then(async () => {
    rommix.registerImageProtocol()
    rommix.store.pruneInstalled()
    await rommix.refreshEmulators()
    registerIpc(rommix)
    rommix.createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) rommix.createWindow()
    })
  })

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.on('window-all-closed', () => app.quit())
}

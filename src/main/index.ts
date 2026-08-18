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
 */
function applyDisplayFlags(): void {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
  app.commandLine.appendSwitch('enable-smooth-scrolling')
}

// Only one instance may own the ROM tree and the download queue.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  applyDisplayFlags()

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

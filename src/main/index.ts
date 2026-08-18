import { BrowserWindow, app, protocol } from 'electron'
import { IMAGE_SCHEME, RommixApp } from './app'
import { registerIpc } from './ipc'

/** Rommix main process bootstrap. */

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

  const rommix = new RommixApp()

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

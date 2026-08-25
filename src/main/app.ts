import { BrowserWindow, protocol, screen, shell } from 'electron'
import { join } from 'node:path'
import { resolveEmulator } from '@config/emulators'
import { BiosManager } from './bios.ts'
import { DownloadManager } from './downloads.ts'
import { detectEmulators } from './emulators.ts'
import { setLanguage } from './i18n.ts'
import { Launcher } from './launcher.ts'
import { log } from './log.ts'
import { RommClient } from './romm.ts'
import { SaveSync } from './saves.ts'
import { rootPaths } from './root.ts'
import { Store } from './store.ts'
import { Updater } from './update.ts'
import type { EmulatorState } from '@shared/types'

export const IMAGE_SCHEME = 'rommix-img'

/**
 * The screen the interface is drawn for: 1080p, the resolution a living-room
 * layout has been designed around for fifteen years.
 */
const DESIGN_HEIGHT = 1080

/** Never smaller than drawn, and never past the point where a shelf holds one game. */
const MIN_SCALE = 1
const MAX_SCALE = 3

/** To the nearest quarter, so a 1440p panel lands on a round 1.25 rather than 1.333…. */
function quantize(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 4) / 4))
}

/**
 * Everything the main process owns, in one object that the IPC layer is handed.
 *
 * The renderer never talks to RomM directly: requests go through here so the
 * access token stays out of the web context and downloads can stream to disk.
 * Cover art is the exception — it goes over a custom protocol that attaches
 * the auth header for us.
 */
export class RomMixApp {
  readonly store = new Store(rootPaths().config)
  readonly client = new RommClient(this.store)
  readonly saveSync = new SaveSync(this.store, this.client)
  readonly launcher = new Launcher(this.store, this.client, this.saveSync)
  readonly downloads: DownloadManager
  readonly bios: BiosManager
  /**
   * RomMix's own updates. Every state it passes through is pushed to the
   * renderer, which is what makes "a new version is available" a notification
   * rather than something only Settings knows about.
   */
  readonly updates = new Updater(this.store, (status) => this.send('update:status', status))

  /** Cached emulator probe; refreshed on demand rather than on every call. */
  private emulatorCache: EmulatorState[] | null = null
  private window: BrowserWindow | null = null

  constructor() {
    // Before anything can have something to say: the store is the only place
    // that knows which language RomMix was left in.
    setLanguage(this.store.settings.language)
    this.downloads = new DownloadManager(this.store, this.client, (system) =>
      this.activeEmulator(system)
    )
    this.bios = new BiosManager(this.store, this.client, (system) => this.activeEmulator(system))
    this.downloads.on('update', (items) => this.send('downloads:update', items))
    // The renderer keeps its own copy of the installed list; without these it
    // would still believe a game is missing right after RomMix adopted it.
    this.downloads.on('installed', () => this.send('library:installed', this.downloads.installed))
    this.downloads.on('adopted', (entries) => this.send('library:adopted', entries))
  }

  async refreshEmulators(): Promise<EmulatorState[]> {
    this.emulatorCache = await detectEmulators(this.store.settings)
    return this.emulatorCache
  }

  /** The probe, running it first if it has never run. */
  async ensureEmulators(): Promise<EmulatorState[]> {
    return this.emulatorCache ?? this.refreshEmulators()
  }

  /**
   * Synchronous view of the last probe, for the download manager's hot path.
   * `system` narrows it to emulators that can actually run that system.
   */
  activeEmulator(system?: string): EmulatorState | null {
    if (!this.emulatorCache) return null
    return resolveEmulator(this.emulatorCache, system, this.store.settings.systemEmulators)
  }

  send(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }

  createWindow(): void {
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0b0d13',
      // A 10-foot UI carries its own chrome; the OS titlebar only gets in the way.
      frame: false,
      fullscreen: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // The preload reaches for `contextBridge` and `ipcRenderer` and nothing
        // else, both of which a sandboxed preload has — so there is no reason
        // to leave Node's module system inside the process that shares an
        // address space with the page.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    window.once('ready-to-show', () => window.show())

    /**
     * The renderer's own failures, which otherwise stay in a DevTools console
     * nobody can open on a television.
     *
     * `render-process-gone` is the important one: the interface disappears and
     * the main process carries on, so without this the log of a crashed UI ends
     * with whatever it was doing a moment earlier and no mention of the crash.
     */
    window.webContents.on('render-process-gone', (_event, details) =>
      log.error('window', 'the interface process died', undefined, { ...details })
    )
    window.webContents.on('unresponsive', () => log.warn('window', 'the interface is unresponsive'))
    window.webContents.on('responsive', () => log.info('window', 'the interface responded again'))
    window.webContents.on('did-fail-load', (_event, code, description, url) =>
      log.error('window', 'the interface failed to load', undefined, { code, description, url })
    )
    window.webContents.on('console-message', (details) => {
      if (details.level !== 'error') return
      log.warn('renderer', details.message, {
        source: `${details.sourceId}:${details.lineNumber}`
      })
    })

    // After the load rather than beside it: a zoom factor set on a WebContents
    // that has not committed a document yet is dropped when one arrives.
    window.webContents.on('did-finish-load', () => this.applyUiScale())
    // A television that reports its real resolution only once it has negotiated
    // a mode, and a window dragged to a second monitor, are the same event here.
    // `screen` outlives the window, so its listener is taken back off again.
    const rescale = (): void => this.applyUiScale()
    screen.on('display-metrics-changed', rescale)
    window.on('moved', rescale)
    window.on('closed', () => screen.removeListener('display-metrics-changed', rescale))

    // Keep navigation inside the app; open real links in the user's browser.
    window.webContents.setWindowOpenHandler(({ url }) => {
      log.info('window', 'opening a link in the browser', { url })
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
    }

    this.window = window
  }

  /**
   * Size the interface for the screen it is actually on.
   *
   * Chromium's zoom factor multiplies the CSS pixel, so the whole stylesheet
   * follows from one number and nothing in it has to be written twice: the
   * layout is identical, only larger. `vw`/`vh` are unaffected by design —
   * measured against a viewport that shrinks by the same factor — so the
   * overscan-safe inset stays the same share of the panel it was.
   *
   * Called on load, on a settings change, and whenever the display or the
   * window moves under it.
   */
  applyUiScale(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.setZoomFactor(this.uiScale())
  }

  /**
   * The factor to render at: the user's, or the one the screen asks for.
   *
   * The automatic answer is the panel's height over the height the interface
   * was drawn for — 2 on a 4K television, which puts every element back at the
   * physical size it has at 1080p, which is the size it was designed to be read
   * at from a sofa.
   *
   * `display.size` is already in device-independent pixels, so a desktop whose
   * compositor scales for itself — 3840x2160 at 200%, reported as 1920x1080 —
   * asks for nothing here, and is not scaled twice. The case this exists for is
   * the opposite one, and the common one on a television: no compositor scaling
   * at all, 3840x2160 handed over whole.
   */
  private uiScale(): number {
    const chosen = this.store.settings.uiScale
    if (chosen > 0) return quantize(chosen)
    if (!this.window || this.window.isDestroyed()) return MIN_SCALE
    const display = screen.getDisplayMatching(this.window.getBounds())
    return quantize(display.size.height / DESIGN_HEIGHT)
  }

  toggleFullscreen(): boolean {
    if (!this.window) return false
    const next = !this.window.isFullScreen()
    this.window.setFullScreen(next)
    return next
  }

  /**
   * Serve RomM images to the renderer with the auth header attached.
   * URLs look like `rommix-img://asset/?p=<url-encoded RomM path>`.
   */
  registerImageProtocol(): void {
    protocol.handle(IMAGE_SCHEME, async (request) => {
      const path = new URL(request.url).searchParams.get('p')
      if (!path) return new Response('missing path', { status: 400 })
      try {
        const upstream = await this.client.asset(path)
        if (!upstream.ok) return new Response('not found', { status: upstream.status })
        return new Response(upstream.body, {
          status: 200,
          headers: {
            'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
            'Cache-Control': 'public, max-age=86400'
          }
        })
      } catch (cause) {
        // Cover art failing is a screen full of blank tiles and no message
        // anywhere, so the reason is only ever visible here.
        log.warn('image', 'could not fetch cover art', {
          path,
          reason: (cause as Error).message
        })
        return new Response((cause as Error).message, { status: 502 })
      }
    })
  }
}

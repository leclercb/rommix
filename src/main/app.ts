import { BrowserWindow, protocol, shell } from 'electron'
import { join } from 'node:path'
import { resolveEmulator } from '@config/emulators'
import { BiosManager } from './bios'
import { DownloadManager } from './downloads'
import { detectEmulators } from './emulators'
import { Launcher } from './launcher'
import { RommClient } from './romm'
import { SaveSync } from './saves'
import { rootPaths } from './root'
import { Store } from './store'
import type { EmulatorState } from '@shared/types'

export const IMAGE_SCHEME = 'rommix-img'

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

  /** Cached emulator probe; refreshed on demand rather than on every call. */
  private emulatorCache: EmulatorState[] | null = null
  private window: BrowserWindow | null = null

  constructor() {
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
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    window.once('ready-to-show', () => window.show())

    // Keep navigation inside the app; open real links in the user's browser.
    window.webContents.setWindowOpenHandler(({ url }) => {
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
        return new Response((cause as Error).message, { status: 502 })
      }
    })
  }
}

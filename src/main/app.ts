import { BrowserWindow, protocol, screen, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveEmulator } from '@config/emulators'
import { BiosManager } from './bios.ts'
import { ConnectionWatch, connectionStatus } from './connection.ts'
import { DownloadManager } from './downloads.ts'
import { Library } from './library.ts'
import { detectEmulators } from './emulators.ts'
import { setLanguage } from './i18n.ts'
import { Launcher } from './launcher.ts'
import { log } from './log.ts'
import { contentTypeOf, OfflineCache, rememberInstalledGames } from './offline.ts'
import { runMigrations } from './migrations.ts'
import { RommClient } from './romm.ts'
import { SaveSync } from './saves.ts'
import { rootPaths } from './root.ts'
import { Store } from './store.ts'
import { Updater } from './update.ts'
import { isWebAddress } from './weblink.ts'
import { saveContext } from './ipc/context.ts'
import type { EmulatorState, SavesWaiting } from '@shared/types'

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
  /** What RomM said about each installed game, for when it cannot be asked. */
  readonly offline = new OfflineCache(rootPaths().offline, this.client)
  /**
   * Whether RomM is reachable, watched rather than merely asked.
   *
   * Every change is pushed, because the interface offers different screens
   * depending on the answer — see the games screen — and a handheld carried out
   * of range asks nothing at all.
   */
  readonly connection = new ConnectionWatch(
    () => connectionStatus(this.store, this.client),
    (status) => {
      this.send('server:status', status)
      // Back on the network is the moment anything left undone for want of a
      // server becomes possible again.
      if (status.connected) void this.catchUp()
    }
  )
  /** What is on this disk, and whether the index still agrees with it. */
  readonly library: Library
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
  /** The pass in progress, so a second trigger joins it. See `catchUp`. */
  private catchingUp: Promise<void> | null = null

  constructor() {
    // Before anything can have something to say: the store is the only place
    // that knows which language RomMix was left in.
    setLanguage(this.store.settings.language)
    // Every request is a connection check with a better answer than any poll:
    // it is being made anyway, and it fails the moment the network does.
    this.client.observeReachability((reachable, reason) =>
      this.connection.observed(reachable, reason)
    )
    this.library = new Library(this.store, this.client, this.offline, (system) =>
      this.activeEmulator(system)
    )
    this.downloads = new DownloadManager(this.store, this.client, this.library)
    this.bios = new BiosManager(this.store, this.client, this.offline, (system) =>
      this.activeEmulator(system)
    )
    this.downloads.on('update', (items) => this.send('downloads:update', items))
    // The renderer keeps its own copy of the installed list; without these it
    // would still believe a game is missing right after RomMix adopted it.
    this.library.on('installed', () => this.send('library:installed', this.library.installed))
    this.library.on('adopted', (entries) => this.send('library:adopted', entries))
  }

  /**
   * Everything that wants a server and has not had one, in one place.
   *
   * Run at start-up and again whenever RomM comes back, because both halves
   * need it — so on a machine that started out of range the reconnection is the
   * only chance either gets. Never twice at once: a reconnection while the
   * first pass is still running joins it rather than starting a second.
   */
  catchUp(): Promise<void> {
    this.catchingUp ??= (async () => {
      // Bracketed, because everything it does is logged by whatever does it and
      // a reader otherwise has to guess which lines belong to the same pass.
      const took = log.since()
      log.info('app', 'catching up with the server')
      await runMigrations({ store: this.store, client: this.client, offline: this.offline })
      await rememberInstalledGames(
        this.store.installed,
        (romId) => this.client.rom(romId),
        this.offline
      ).catch((cause: Error) =>
        log.info('offline', 'could not write down the games that had nothing', {
          reason: cause.message
        })
      )
      await this.rememberServer()
      await this.sendUnsentSaves()
      // Last, and after the saves: a queue of games is minutes of bandwidth,
      // and the saves are the part that cannot be fetched again.
      await this.downloads
        .resumeAfterOutage()
        .catch((cause: Error) =>
          log.info('download', 'could not pick the queue up again', { reason: cause.message })
        )
      log.info('app', 'caught up', { ms: took() })
    })().finally(() => {
      this.catchingUp = null
    })
    return this.catchingUp
  }

  /**
   * Keep the answers three local screens are built on. See `OfflineCache`.
   *
   * Deliberately not a migration, though it runs on the same trigger: a
   * migration is recorded once and never runs again, and this is a list that
   * has to keep up with a server that gains platforms and firmware. Nor is it
   * left to the screens that read it — before this, the platform list was
   * written only if somebody happened to open the Library, the Emulators page
   * or BIOS while connected, so whether RomMix worked out of range depended on
   * where the user had been.
   *
   * One request for the platforms, every time. The firmware behind them is one
   * request *per platform*, so it is taken only when there is none at all, and
   * refreshed from then on by the BIOS screen whenever it is looked at.
   */
  private async rememberServer(): Promise<void> {
    try {
      const platforms = await this.client.platforms()
      await this.offline.savePlatforms(platforms)

      // Whether the firmware has ever been captured is the difference between
      // a BIOS screen that works away from the server and one that refuses to
      // draw, and it is asked once and then never again — so the run that does
      // it is the only place a log could ever say so.
      const firstFirmware = (await this.offline.firmware()) === null
      if (firstFirmware) await this.bios.capture()
      log.info('offline', 'wrote down what the server holds', {
        platforms: platforms.length,
        firmware: firstFirmware ? 'captured' : 'already had it'
      })
    } catch (cause) {
      log.info('offline', 'could not write down what the server holds', {
        reason: (cause as Error).message
      })
    }
  }

  /**
   * Hand RomM the saves written while it was away, as far as that is safe.
   *
   * The last step of the catch-up, and the only one that can destroy something:
   * a save pushed over a newer one made on another device is gone from both
   * ends. So nothing is decided from what was recorded — the record names a
   * game and a moment, and everything else is worked out against the server as
   * it is now. See `SaveSync.drain` and `mayBeSentUnasked`.
   *
   * Sending unasked is what `confirmSavePush` is already about, so it is the
   * same switch here: with it on, even the files that could go up safely wait
   * to be confirmed on the game's own screen.
   */
  private async sendUnsentSaves(): Promise<void> {
    if (!this.store.settings.syncSavesUp || this.store.unsentSaves.length === 0) return
    const sendUnasked = !this.store.settings.confirmSavePush

    const sent: number[] = []
    const waiting: SavesWaiting[] = []

    for (const { romId, since } of this.store.unsentSaves) {
      try {
        const target = await saveContext(this, romId)
        const result = await this.saveSync.drain(target, since, { sendUnasked })
        if (result.sent > 0) sent.push(romId)

        // Nothing waiting means nothing to come back for, however the record
        // came to be written.
        if (result.conflicts === 0 && result.ready === 0) {
          this.settleUnsentSaves(romId, result.sent > 0 ? 'all of it went up' : 'nothing to send')
          continue
        }
        // Only where the setting is what is holding them. With sending set to
        // go ahead unasked, `ready` counts uploads the server refused — real,
        // and not the setting's doing, so saying so would explain a file with
        // the one reason that is certainly not why. The record stays either
        // way, and the next reconnection tries again.
        const held = sendUnasked ? 0 : result.ready
        if (result.conflicts > 0 || held > 0) {
          waiting.push({ romId, conflicts: result.conflicts, ready: held })
        }
      } catch (cause) {
        // The game may have been uninstalled, its emulator changed, or the
        // server gone again mid-pass. The record stays and the next catch-up
        // tries it: nothing is sent and nothing is lost by waiting.
        log.info('saves', 'could not send what a session left behind', {
          romId,
          reason: (cause as Error).message
        })
      }
    }
    /**
     * Said once, and only where something actually moved.
     *
     * The games rather than the files: a session writes a save and a state and
     * sometimes several of each, and none of those numbers is what the person
     * was wondering about — which of their games are safe now is. Named rather
     * than counted, so a notification about one game can show it the way every
     * other notification about a game does, with its cover and its title.
     *
     * What is *not* said is the other half. Saves RomMix would not send on its
     * own stay on the game's own page, which is the only screen with the button
     * that answers them.
     */
    if (sent.length > 0) this.send('saves:sent', sent)
    // Built from the pass that just ran rather than by asking again: every
    // entry here cost a listing from the server a moment ago, and repeating
    // them all would double what a reconnection costs to say the same thing.
    this.send('saves:waiting', waiting)

    // One line for the pass, since the per-game ones are scattered through the
    // loop above and none of them says how it came out.
    log.info('saves', 'handed over what a spell offline left behind', {
      sent: sent.length,
      waiting: waiting.length,
      asked: !sendUnasked
    })
  }

  /**
   * Stop expecting this game's saves, and say so.
   *
   * The record going is the end of the whole business for that game — the
   * notice on its page goes with it — and three different conclusions reach it:
   * everything went up, the game was uninstalled, or there was nothing there
   * after all. Logged in one place so the reason is always named.
   */
  private settleUnsentSaves(romId: number, because: string): void {
    this.store.clearUnsentSaves(romId)
    log.info('saves', 'nothing left to send for this game', { romId, because })
  }

  /**
   * Look again at what this game still owes, after a push.
   *
   * Asked rather than assumed. A push that was refused file by file resolves
   * having sent nothing, and an approval from the post-session dialog covers
   * only the session it previewed — so "a push happened" is not "there is
   * nothing left", and treating it as such loses the record for files that are
   * still only on this disk. `waitingSaves` recomputes and clears whatever has
   * genuinely gone.
   */
  async recheckUnsentSaves(romId: number): Promise<void> {
    if (!this.store.unsentSaves.some((row) => row.romId === romId)) return
    this.send('saves:waiting', await this.waitingSaves())
  }

  /**
   * The games whose saves are on this disk and not on RomM.
   *
   * Carries why as well as which, because the game's page says so in as many
   * words: a copy RomM holds from another device and a setting that asks before
   * sending are different things to be told, and the second is not a problem at
   * all.
   *
   * Recomputed rather than remembered — what is outstanding depends on what
   * RomM holds right now — and a game the index has lost is one that was
   * uninstalled, which takes its record with it.
   */
  async waitingSaves(): Promise<SavesWaiting[]> {
    // Nothing is ever pushed automatically with up-sync off, so nothing is
    // waiting on RomMix — and both reasons the game screen gives would be the
    // wrong explanation for a user who switched pushing off on purpose.
    if (!this.store.settings.syncSavesUp) return []

    const waiting: SavesWaiting[] = []
    const sendUnasked = !this.store.settings.confirmSavePush

    for (const { romId, since } of this.store.unsentSaves) {
      if (!this.store.getInstalled(romId)) {
        this.settleUnsentSaves(romId, 'the game is no longer installed')
        continue
      }
      try {
        const target = await saveContext(this, romId)
        // Nothing is sent from here: this only reports. Which is why the record
        // is cleared against what is *actually* outstanding and never against
        // the adjusted figure below — a file nobody has sent is a file still on
        // this disk, whatever the reason for it is called.
        const counted = await this.saveSync.drain(target, since, { sendUnasked: false })
        if (counted.conflicts === 0 && counted.ready === 0) {
          this.settleUnsentSaves(romId, 'nothing left outstanding')
          continue
        }
        // Only where the setting is what is holding them: with sending set to
        // go ahead unasked, these are not waiting on anybody and the catch-up
        // has either sent them or will. A game left with no reason to give is
        // left out of the list rather than listed and unable to explain itself.
        const ready = sendUnasked ? 0 : counted.ready
        if (counted.conflicts > 0 || ready > 0) {
          waiting.push({ romId, conflicts: counted.conflicts, ready })
        }
      } catch (cause) {
        // Unanswerable right now — see `sendUnsentSaves`. The game is left out
        // rather than guessed at, and said so: a notice that does not appear is
        // otherwise a thing with no trace anywhere.
        log.info('saves', 'could not work out what this game still owes', {
          romId,
          reason: (cause as Error).message
        })
      }
    }
    return waiting
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
    // Which links those may be is `isWebAddress`, the same rule the
    // `system:openExternal` channel is held to — both reach the desktop's URL
    // handlers, and there is no version of this where one of them may not.
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (!isWebAddress(url)) {
        log.warn('window', 'refused to open a link that is not a web address', { url })
        return { action: 'deny' }
      }
      log.info('window', 'opening a link in the browser', { url })
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    /**
     * The other half of the same rule.
     *
     * `setWindowOpenHandler` is only asked about a *new* window. A page that
     * assigns `location` navigates the one already here, which would replace
     * the interface with a document carrying none of its `<meta>` CSP while
     * still having the preload — and so `window.rommix` — attached to it.
     *
     * Every route in RomMix is state rather than a URL, so the renderer
     * navigates exactly once and to the document it started at. Anything else,
     * in either build, is something nothing here asked for. The one exception
     * is a target equal to the document already loaded, which is that same
     * document again rather than a move away from it.
     */
    window.webContents.on('will-navigate', (event, url) => {
      if (url === window.webContents.getURL()) return
      log.warn('window', 'refused to navigate away from the interface', { url })
      event.preventDefault()
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
   *
   * The copy saved when the game was installed is preferred to the server's,
   * which is what makes every cover, screenshot and console icon on a screen
   * draw with nothing reachable. It is also the faster answer for a library of
   * games already on the disk: a page of them is sixty round trips otherwise.
   *
   * Preferring it is not the same as showing something out of date. A saved
   * picture answers for one exact RomM path, and RomM stamps the path with the
   * ROM's `updated_at` — so a cover it has replaced is asked for under a stamp
   * nothing here was saved under, misses, and comes off the wire. This is the
   * one read in RomMix that looks at the saved copy first; everything else
   * asks the server and falls back. See `OfflineCache`.
   */
  registerImageProtocol(): void {
    protocol.handle(IMAGE_SCHEME, async (request) => {
      const path = new URL(request.url).searchParams.get('p')
      if (!path) return new Response('missing path', { status: 400 })

      try {
        /**
         * The saved copy, if it is still there a moment after it was found.
         *
         * Inside the try, because `assetFile` is a check and this is the read:
         * uninstalling a game deletes its covers while a notification is still
         * drawing one of them. Losing that race falls through to the server,
         * which is the answer the request would have had anyway.
         */
        const cached = this.offline.assetFile(path)
        if (cached) {
          const bytes = await readFile(cached).catch(() => null)
          if (bytes) {
            return new Response(bytes, {
              status: 200,
              headers: {
                'Content-Type': contentTypeOf(cached),
                'Cache-Control': 'public, max-age=86400'
              }
            })
          }
        }

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

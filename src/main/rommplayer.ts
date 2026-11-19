import { join } from 'node:path'
import { BrowserWindow, ipcMain, session, shell } from 'electron'
import { LEAVE_HOLD_MS } from '@shared/hold'
import type { RommPlayer } from '@shared/types'
import { t } from './i18n.ts'
import { log } from './log.ts'
import { RommClient, RommError } from './romm/index.ts'
import type { Store } from './store.ts'
import { isWebAddress } from './weblink.ts'

/**
 * The session the player pages run in.
 *
 * Kept apart from the interface's own so that the header added below reaches
 * RomM's pages and nothing RomMix itself loads. Without the `persist:` prefix,
 * so nothing a page stores outlives RomMix.
 */
const PARTITION = 'romm-player'

/** Chromium's `ERR_CERT_AUTHORITY_INVALID`: a chain nobody this machine trusts vouches for. */
const AUTHORITY_INVALID = -202

/**
 * The page RomM's own interface opens to play a game in the browser, or to
 * stream it from an emulator the server runs. Routes from RomM's
 * `frontend/src/plugins/router.ts`.
 */
export function playerUrl(baseUrl: string, romId: number, player: RommPlayer): string {
  const page = player === 'browser' ? 'ejs' : 'stream'
  return `${baseUrl.replace(/\/+$/, '')}/rom/${romId}/${page}`
}

/**
 * Is this RomM's sign-in page?
 *
 * Where RomM's interface sends a visitor it does not know, which for the player
 * means the token was not taken in place of a sign-in. Under the server's own
 * path, for a RomM served below the root of its host.
 */
export function isSignInPage(url: string, baseUrl: string): boolean {
  try {
    const page = new URL(url)
    const base = new URL(baseUrl)
    const login = `${base.pathname.replace(/\/+$/, '')}/login`
    return (
      page.origin === base.origin &&
      (page.pathname === login || page.pathname.startsWith(`${login}/`))
    )
  } catch {
    return false
  }
}

/** Is this one of RomM's player pages, which `playerUrl` names? */
export function isPlayerPage(url: string): boolean {
  try {
    return /\/rom\/\d+\/(?:ejs|stream)\/?$/.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/**
 * How long RomM is given to hand the page back when asked to leave — see
 * `RommPlayerWindow.leave`. Its exit uploads the save the game has not sent
 * yet, so this is time for a request, not for a click.
 */
const LEAVE_TIMEOUT_MS = 15_000

/**
 * How often the token is renewed while a player is open. RomM's page carries
 * the token RomMix holds — see `RommPlayerWindow.session` — and nothing else
 * renews it while RomMix is idle behind the player: one that lapses mid-game
 * is a save RomM refuses, then a page sent to sign in.
 */
const TOKEN_CHECK_MS = 60_000

/**
 * A key the player was left with, still down as the window goes.
 *
 * Its repeats would otherwise land on RomMix's own window and be read there
 * as presses of its own: an Escape held to leave the game opening RomMix's
 * power menu. See `RomMixApp.ignoreUntilReleased`.
 */
export interface HeldKeys {
  ignoreUntilReleased(key: string): void
  released(key: string): void
}

/** A hostname without the brackets an IPv6 address is written in inside a URL. */
function bareHost(host: string): string {
  return host.replace(/^\[|\]$/g, '')
}

/**
 * Ask RomM's interface to leave the player for the game's own page.
 *
 * Through its router, because that is the way out RomM's player waits on: the
 * guard it puts on the route uploads the save the game has not sent yet and
 * ends the play session, then replaces the page. Closing the window instead
 * meets the unload prompt RomM raises while a game runs, which a window with
 * no one to answer it never gets past. The router is the one Vue hangs on the
 * element RomM mounts on, `#app` in RomM's `frontend/src/main.ts`.
 *
 * Answers whether there was a router to ask.
 */
function leaveScript(path: string): string {
  return `(() => {
    const router = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$router
    if (!router) return false
    void router.push(${JSON.stringify(path)})
    return true
  })()`
}

/** Is this request one to the RomM server, and so one to sign in? */
export function isServerRequest(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

/**
 * A game played on RomM rather than here, in a window of its own.
 *
 * RomM's interface signs in with a cookie, and RomMix holds a token instead, so
 * every request to the server carries the token RomMix's own requests carry —
 * the same account, signed in the way it already is. RomM keeps the saves, as
 * it does for any game played in its interface.
 *
 * One at a time, like a game. The window covers RomMix and the running
 * overlay that says how to leave, so the player says it too, and takes Start
 * held on a pad or Escape held on a keyboard as the way back — see
 * `src/preload/player.ts`. Every way back goes through `leave`, so the game's
 * save reaches RomM first.
 */
export class RommPlayerWindow {
  private window: BrowserWindow | null = null
  private prepared = false
  private listening = false
  private leaving = false
  private romId: number | null = null
  /** Settles once the open window has closed. See `shutdown`. */
  private closing: Promise<unknown> | null = null

  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    private readonly keys: HeldKeys
  ) {}

  get isOpen(): boolean {
    return this.window !== null
  }

  /**
   * Leave the player the way RomM's own exit does — see `leaveScript` — and
   * close the window once the page is off it.
   *
   * A page RomM has no router on is closed directly, past its unload prompt:
   * RomM still sends what it can of the save as the page goes. And a page that
   * has not left by `LEAVE_TIMEOUT_MS` is closed regardless, since a player
   * that cannot be left is worse than a save RomM did not get.
   */
  leave(): void {
    const window = this.window
    if (!window || this.leaving || this.romId === null) return
    this.leaving = true
    const path = `/rom/${this.romId}`
    log.info('player', 'leaving', { romId: this.romId })

    setTimeout(() => {
      if (this.window !== window) return
      log.warn('player', 'RomM did not leave the player in time, closing it')
      window.destroy()
    }, LEAVE_TIMEOUT_MS)

    // The token renewed first, if it has lapsed: the exit is what uploads the
    // save, and a refused upload is the one thing leaving is careful about.
    this.client
      .emulation()
      .catch(() => null)
      .then(() => {
        if (window.isDestroyed()) return false
        return window.webContents.executeJavaScript(leaveScript(path))
      })
      .then((asked: unknown) => {
        if (window.isDestroyed()) return
        if (asked === true) return
        log.warn('player', 'no router on the page to leave through, closing it')
        window.close()
      })
      .catch((cause: Error) => {
        log.warn('player', 'could not ask the page to leave', { reason: cause.message })
        if (!window.isDestroyed()) window.close()
      })
  }

  /**
   * Leave the player before RomMix quits, and wait until it has gone: quitting
   * otherwise closes the window under RomM's unload prompt, and the quit waits
   * on a prompt nobody can answer. Bounded by `leave`'s own timeout.
   */
  async shutdown(): Promise<void> {
    if (!this.window) return
    this.leave()
    await this.closing
  }

  /** Close the window at once, saved or not. */
  forceClose(): void {
    log.warn('player', 'closed without leaving')
    this.window?.destroy()
  }

  /**
   * Open the player and resolve once it has been closed.
   *
   * Rejects where the page could not be played: it did not load, the server
   * answered with an error, or RomM sent it to sign in. The window is closed
   * then rather than left on a page with nothing to play, and the reason is
   * what the screen says.
   */
  async play(romId: number, player: RommPlayer): Promise<void> {
    const server = this.store.server
    if (!server) throw new RommError(t('error.noServerConfigured'))
    // One at a time: a second window would take the first one's place here,
    // and the first would then be one nothing can close.
    if (this.window) throw new RommError(t('launch.alreadyRunning'))
    // Asked through the client first, so a token that has expired is refreshed
    // before a page is opened with it.
    await this.client.emulation()

    const url = playerUrl(server.baseUrl, romId, player)
    const origin = this.client.origin
    const window = new BrowserWindow({
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      frame: false,
      fullscreen: true,
      webPreferences: {
        session: this.session(),
        preload: join(__dirname, '../preload/player.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.window = window
    this.romId = romId
    this.leaving = false
    window.once('ready-to-show', () => window.show())
    this.listen()

    // Any other close — the window manager, the compositor, a key the desktop
    // binds — is a way out like the others, and goes the same way: through
    // RomM's exit, which a plain close would meet the unload prompt in front of.
    window.on('close', (event) => {
      if (this.leaving) return
      event.preventDefault()
      this.leave()
    })

    const keepFresh = setInterval(() => {
      this.client
        .emulation()
        .catch((cause: Error) =>
          log.info('player', 'could not renew the token', { reason: cause.message })
        )
    }, TOKEN_CHECK_MS)

    /**
     * Off the player page is the game over, whoever ended it: RomMix asking to
     * leave, or the Quit in RomM's own player menu. Either way RomM has sent
     * the save by then and the page left is RomM's interface, which is not what
     * the window is for. Whether RomM got there by replacing the document or
     * within it. The sign-in page is not this but a failure — see `fail`.
     */
    const handedBack = (next: string): void => {
      if (isPlayerPage(next) || isSignInPage(next, server.baseUrl)) return
      if (window.isDestroyed()) return
      log.info('player', 'the page left the player', { url: next })
      window.destroy()
    }
    // RomM's prompt stands down once its exit has run. One still up while
    // leaving is from a page that could not be left through its router, and
    // nobody is there to answer it.
    window.webContents.on('will-prevent-unload', (event) => {
      if (this.leaving) event.preventDefault()
    })

    window.webContents.on('did-finish-load', () =>
      window.webContents.send('player:hint', t('player.howToLeave'))
    )
    /**
     * Escape held, and acted on the moment the hold is long enough.
     *
     * Held rather than pressed, because RomM's player takes Escape itself. A
     * held key repeats, so the hold is the time since the press that started
     * the run — a press that is not a repeat starts a new one, so a release
     * this window never saw cannot leave a hold half done. From then on the key
     * is not the page's, and RomMix's own window ignores it until it is let go.
     */
    let escapeSince: number | null = null
    let escapeHeld = false
    window.webContents.on('before-input-event', (event, input) => {
      if (input.key !== 'Escape') return
      if (input.type === 'keyUp') {
        if (escapeHeld) {
          event.preventDefault()
          this.keys.released('Escape')
        }
        escapeSince = null
        escapeHeld = false
        return
      }
      const now = Date.now()
      if (escapeSince === null || !input.isAutoRepeat) escapeSince = now
      if (!escapeHeld && now - escapeSince >= LEAVE_HOLD_MS) {
        escapeHeld = true
        log.info('player', 'Escape held')
        this.keys.ignoreUntilReleased('Escape')
        this.leave()
      }
      if (escapeHeld) event.preventDefault()
    })

    window.webContents.on('render-process-gone', (_event, details) =>
      log.error('player', 'the player page died', undefined, { ...details })
    )

    let failure: string | null = null
    const fail = (message: string, detail: Record<string, unknown>): void => {
      if (failure !== null) return
      failure = message
      log.error('player', 'the player page could not be played', undefined, { ...detail })
      // Destroyed rather than closed: a page that never worked has nothing to
      // be asked about before it goes.
      if (!window.isDestroyed()) window.destroy()
    }
    // Chromium's `ERR_ABORTED`, which is a navigation replaced by another
    // rather than one that failed.
    const ABORTED = -3
    window.webContents.on('did-fail-load', (_event, code, description, failed, isMainFrame) => {
      if (!isMainFrame || code === ABORTED) return
      fail(t('error.playerFailed', { reason: description }), { code, description, url: failed })
    })
    window.webContents.on('did-navigate', (_event, next, status) => {
      if (isSignInPage(next, server.baseUrl)) {
        fail(t('error.playerNotSignedIn'), { url: next })
      } else if (status >= 400) {
        fail(t('error.playerFailed', { reason: `HTTP ${status}` }), { url: next, status })
      } else {
        handedBack(next)
      }
    })
    // RomM's interface changes page without loading one, which is how it sends
    // a visitor it does not know to sign in, and how its player is left.
    window.webContents.on('did-navigate-in-page', (_event, next, isMainFrame) => {
      if (!isMainFrame) return
      if (isSignInPage(next, server.baseUrl)) fail(t('error.playerNotSignedIn'), { url: next })
      else handedBack(next)
    })
    // The page stays RomM's: a link off the server goes to the browser, which is
    // where a link out of the interface goes too.
    window.webContents.on('will-navigate', (event, next) => {
      if (isServerRequest(next, origin)) return
      event.preventDefault()
      if (isWebAddress(next)) void shell.openExternal(next)
    })
    window.webContents.setWindowOpenHandler(({ url: next }) => {
      if (isWebAddress(next)) void shell.openExternal(next)
      return { action: 'deny' }
    })

    // Settles with the reason the page could not be played, if there was one,
    // rather than rejecting: a failure during the load lands before anything
    // is waiting on this.
    const closed = new Promise<string | null>((resolve) =>
      window.once('closed', () => {
        clearInterval(keepFresh)
        this.window = null
        this.romId = null
        this.leaving = false
        log.info('player', 'closed', { romId, player })
        resolve(failure)
      })
    )
    this.closing = closed

    log.info('player', 'opening a game on RomM', { romId, player, url })
    try {
      await window.loadURL(url)
    } catch (cause) {
      fail(t('error.playerFailed', { reason: (cause as Error).message }), { url })
    }
    const reason = await closed
    if (reason !== null) throw new RommError(reason)
  }

  /**
   * Start held in the player, which its preload reports. Only from the player
   * window itself: nothing else has a reason to send it.
   */
  private listen(): void {
    if (this.listening) return
    this.listening = true
    ipcMain.on('player:leave', (event) => {
      if (!this.window || event.sender !== this.window.webContents) return
      log.info('player', 'Start held')
      this.leave()
    })
  }

  /**
   * The player's session, prepared once.
   *
   * The certificate rule is the one `acceptSelfSigned` already applies to
   * RomMix's own requests: who vouches for the server is forgiven, a
   * certificate for another name or out of date is not.
   */
  private session(): Electron.Session {
    const player = session.fromPartition(PARTITION)
    if (this.prepared) return player
    this.prepared = true

    player.webRequest.onBeforeSendHeaders((details, callback) => {
      const authorization = isServerRequest(details.url, this.client.origin)
        ? this.client.authorization()
        : null
      callback({
        requestHeaders: authorization
          ? { ...details.requestHeaders, Authorization: authorization }
          : details.requestHeaders
      })
    })
    player.setCertificateVerifyProc((request, callback) => {
      const forgiven =
        this.store.settings.acceptSelfSigned &&
        request.errorCode === AUTHORITY_INVALID &&
        bareHost(request.hostname) === bareHost(new URL(this.client.origin).hostname)
      // -3 keeps Chromium's own verdict.
      callback(forgiven ? 0 : -3)
    })
    return player
  }
}

import type { ConnectionStatus } from '@shared/types'
import { t } from './i18n.ts'
import { log } from './log.ts'
import { refusedUs } from './romm.ts'
import type { RommClient } from './romm.ts'
import type { Store } from './store.ts'

/**
 * Whether RomM is there, asked once and then kept an eye on.
 *
 * Two callers want the same answer for different reasons. The renderer asks for
 * it — on start-up, and after signing in — to decide between the sign-in screen
 * and the library. And nobody asks for it at all while a handheld is carried
 * out of range, which is the case that matters: the screens that need the
 * server have to give way to the ones that do not, and come back on their own
 * when the network does. So it is also polled, and every change is pushed.
 */

/**
 * How long to wait before asking again, having just been told it is not there.
 *
 * This is the only way back: away from the server most of the interface is
 * disabled, so almost nothing is being asked and there are no failures left to
 * learn from. Short, because it decides how long a handheld carried back into
 * the room keeps showing an offline library — and cheap, because a request with
 * no route to the host fails immediately rather than waiting on a timeout.
 */
const PROBE_WHILE_AWAY_MS = 10_000

/**
 * And having just been told it is.
 *
 * A backstop rather than the mechanism. While there is a server every screen is
 * making requests against it, and the first one to fail says so within the
 * request rather than within an interval — so this exists only for a session
 * sitting on a screen that asks nothing at all. See `observed`.
 */
const PROBE_WHILE_CONNECTED_MS = 120_000

/**
 * How long the check waits for an answer before calling it away.
 *
 * A network that refuses a connection fails in milliseconds and needs none of
 * this. The case it is for is the one a handheld meets most: a network that is
 * joined and goes nowhere — a captive portal, an access point that has stopped
 * forwarding — where nothing fails and nothing answers, and every screen sits
 * on a spinner for as long as the operating system's own timeout, which is
 * measured in minutes.
 *
 * Short enough to be over before anybody reaches for the power button, and safe
 * because it is not final: a server that was merely slow is put back the moment
 * any request gets through. See `ConnectionWatch.observed`.
 */
const CHECK_TIMEOUT_MS = 5_000

/** The check gave up. A sentinel, so it cannot be confused with an answer. */
const NO_ANSWER = Symbol('no answer')

/** Resolves to `NO_ANSWER`, and never keeps the process alive to do it. */
function givingUpAfter(ms: number): Promise<typeof NO_ANSWER> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(NO_ANSWER), ms).unref()
  })
}

/**
 * Ask RomM who we are and whether it is running.
 *
 * `timeoutMs` is a seam for the tests, which cannot afford to sit out the real
 * bound; nothing in the application passes it.
 */
export async function connectionStatus(
  store: Store,
  client: RommClient,
  timeoutMs = CHECK_TIMEOUT_MS
): Promise<ConnectionStatus> {
  const server = store.server
  const creds = store.credentials
  const configured = Boolean(server && (creds.accessToken || creds.clientToken))

  if (!server || !configured) {
    return {
      connected: false,
      configured,
      offline: false,
      baseUrl: server?.baseUrl ?? null,
      user: null,
      serverVersion: null,
      error: null
    }
  }

  try {
    /**
     * The pair of calls, or the clock, whichever comes first.
     *
     * The requests are not cancelled when the clock wins — there is no signal
     * to cancel them with, and one that lands late is harmless: it reports its
     * own reachability through `RommClient`, which is what puts a slow server
     * back. A late rejection is not unhandled either, `Promise.race` having
     * attached a handler to both the moment it was called.
     */
    const answer = await Promise.race([
      Promise.all([client.me(), client.heartbeat()]),
      givingUpAfter(timeoutMs)
    ])

    if (answer === NO_ANSWER) {
      log.warn('server', 'the server did not answer in time', { baseUrl: server.baseUrl })
      return {
        connected: false,
        configured: true,
        offline: true,
        baseUrl: server.baseUrl,
        user: null,
        serverVersion: null,
        error: t('error.serverTimedOut', { url: server.baseUrl })
      }
    }

    const [user, beat] = answer
    return {
      connected: true,
      configured: true,
      offline: false,
      baseUrl: server.baseUrl,
      user,
      serverVersion: beat.version,
      error: null
    }
  } catch (cause) {
    log.warn('server', 'not connected', {
      baseUrl: server.baseUrl,
      reason: (cause as Error).message
    })
    return {
      connected: false,
      configured: true,
      offline: !refusedUs(cause),
      baseUrl: server.baseUrl,
      user: null,
      serverVersion: null,
      error: (cause as Error).message
    }
  }
}

/**
 * The same question on a timer, announcing only the answers that changed.
 *
 * Only the change: the status is what the interface is built around while it
 * lasts, and pushing the same one every half minute would redraw the screen
 * somebody is reading for nothing.
 */
export class ConnectionWatch {
  private timer: NodeJS.Timeout | null = null
  private last: ConnectionStatus | null = null
  /** Whether a check is out, so a burst of failures does not start several. */
  private asking = false

  constructor(
    private readonly read: () => Promise<ConnectionStatus>,
    private readonly announce: (status: ConnectionStatus) => void
  ) {}

  /** The current answer, announced if it differs from the last one. */
  async refresh(): Promise<ConnectionStatus> {
    const next = await this.read()
    this.settle(next)
    return next
  }

  /**
   * What a request that was made anyway just found out.
   *
   * The fast half of this class, and the one that matters on a handheld: a
   * connection lost mid-session used to go unnoticed until the next poll, which
   * is a screenful of failures and a mode that arrives long after the user has
   * worked out for themselves what happened. Every call RomMix makes now says
   * whether it got there, so the interface changes shape on the first failure.
   *
   * A failure is acted on without asking anything — there is nothing to ask,
   * which is the whole point. Getting through is worth a round trip, because
   * being connected means saying who is signed in and to what, and only the
   * check knows that.
   */
  observed(reachable: boolean, reason?: string): void {
    if (reachable) {
      if (this.last?.connected !== true) this.probe()
      return
    }

    const last = this.last
    // Nothing to go on before the first check, and nothing to say for a device
    // that was never signed in — an unreachable server it does not have is not
    // offline mode, it is the sign-in screen.
    if (!last?.configured || last.offline) return

    this.settle({
      connected: false,
      configured: true,
      offline: true,
      baseUrl: last.baseUrl,
      user: null,
      serverVersion: null,
      error: reason ?? null
    })
  }

  /** Record an answer somebody else already has, without asking again. */
  seen(status: ConnectionStatus): void {
    this.last = status
  }

  start(): void {
    this.arm()
  }

  stop(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  /** Take an answer, announce it if it changes anything, and re-time the probe. */
  private settle(next: ConnectionStatus): void {
    const changed =
      this.last === null ||
      this.last.connected !== next.connected ||
      this.last.offline !== next.offline ||
      this.last.configured !== next.configured
    this.last = next
    if (changed) {
      this.announce(next)
      // The two states are watched at different rates, so a change is also a
      // change of schedule. Only on a change: re-timing on every answer would
      // push the probe out indefinitely on a busy screen.
      if (this.timer) this.arm()
    }
  }

  /**
   * Ask, once, with nothing else asking at the same time.
   *
   * A screen going offline fails several requests at once and each of them
   * reports it; without this, coming back would start a check per request.
   */
  private probe(): void {
    if (this.asking) return
    this.asking = true
    void this.refresh()
      .catch((cause: Error) =>
        log.debug('server', 'the connection check failed', { reason: cause.message })
      )
      .finally(() => {
        this.asking = false
      })
  }

  /** Re-arm the timer at the rate the current state calls for. */
  private arm(): void {
    this.stop()
    const delay = this.last?.connected ? PROBE_WHILE_CONNECTED_MS : PROBE_WHILE_AWAY_MS
    this.timer = setTimeout(() => {
      this.arm()
      this.probe()
    }, delay)
    // Housekeeping: it must never be the reason a quit waits.
    this.timer.unref()
  }
}

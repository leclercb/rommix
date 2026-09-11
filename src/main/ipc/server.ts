import type { ConnectPayload } from '@shared/api'
import type { ConnectionStatus } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { log } from '../log.ts'
import { RommError, normaliseBaseUrl } from '../romm/index.ts'
import { t } from '../i18n.ts'
import type { Handle } from './handler.ts'

/** Which server RomMix is signed in to, and how it got there. */
export function registerServerIpc(rommix: RomMixApp, handle: Handle): void {
  const { store, client } = rommix

  /**
   * Current connection state, including who we are signed in as.
   *
   * Through the watch rather than straight to `connectionStatus`, so an answer
   * somebody asked for counts as one the watch has seen: the interface changes
   * shape between connected and offline, and a push arriving a moment later
   * saying what the screen already knows would redraw it for nothing.
   */
  const status = (): Promise<ConnectionStatus> => rommix.connection.refresh()

  handle('server:status', status)

  handle('server:connect', async (payload: ConnectPayload): Promise<ConnectionStatus> => {
    const baseUrl = normaliseBaseUrl(payload.baseUrl)
    const previousServer = store.server
    /**
     * What was signed in before this attempt, kept whole.
     *
     * The rollback below used to clear the credentials outright, which made
     * mistyping a password for server B a sign-out from server A. That is not
     * a hypothetical route to the Connect screen: `UnsupportedServerError`
     * sends a user there with perfectly good credentials on disk, and the
     * screen's own comment says it leaves the app as it found it.
     */
    const previousCredentials = store.credentials

    // Confirm it is a RomM instance before we store anything.
    await client.heartbeat(baseUrl)
    store.setServer({ baseUrl, authMode: payload.mode, username: payload.username })

    try {
      if (payload.mode === 'password') {
        if (!payload.username || !payload.password) {
          throw new RommError(t('error.credentialsRequired'))
        }
        await client.loginWithPassword(payload.username, payload.password, baseUrl)
      } else if (payload.mode === 'token') {
        if (!payload.token) throw new RommError(t('error.tokenRequired'))
        client.setClientToken(payload.token)
      }
      // 'device' mode has already stored its token via pollPairing.

      const result = await status()
      if (!result.connected) throw new RommError(result.error ?? t('error.couldNotSignIn'))
      await rommix.refreshEmulators()
      log.info('server', 'connected', {
        baseUrl,
        mode: payload.mode,
        user: result.user?.username ?? null,
        serverVersion: result.serverVersion
      })
      return result
    } catch (cause) {
      // Leave the app as we found it rather than half-connected.
      log.error('server', 'sign-in failed, rolling back to the previous server', cause, {
        baseUrl,
        mode: payload.mode
      })
      // The server first, so the device id it drops on a changed address is
      // put back by the credentials below rather than the other way round.
      store.setServer(previousServer)
      store.setCredentials(previousCredentials)
      throw cause
    }
  })

  handle('server:disconnect', async () => {
    log.info('server', 'signed out', { baseUrl: store.server?.baseUrl ?? null })
    store.clearCredentials()
    store.setServer(null)
  })

  handle('server:startPairing', async (baseUrl: string) => {
    const normalised = normaliseBaseUrl(baseUrl)
    const previousServer = store.server
    const previousCredentials = store.credentials
    await client.heartbeat(normalised)
    // Repointed before the request rather than after it, because the token
    // pairing hands back is issued by *this* server and `setServer` drops the
    // device id whenever the address changes — see `Store.setServer`.
    store.setServer({ baseUrl: normalised, authMode: 'device' })
    try {
      return await client.startDevicePairing(normalised)
    } catch (cause) {
      // Rolled back for the same reason `server:connect` rolls back. Without
      // it a pairing that could not be started left RomMix pointed at an
      // address nothing was signed in to, holding the previous server's
      // tokens, reporting itself configured and failing every request.
      log.error('server', 'pairing could not be started, rolling back', cause, {
        baseUrl: normalised
      })
      store.setServer(previousServer)
      store.setCredentials(previousCredentials)
      throw cause
    }
  })

  handle('server:pollPairing', async (deviceCode: string, baseUrl: string) =>
    client.pollDevicePairing(deviceCode, normaliseBaseUrl(baseUrl))
  )
}

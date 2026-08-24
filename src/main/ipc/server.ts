import type { ConnectPayload } from '@shared/api'
import type { ConnectionStatus } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { log } from '../log.ts'
import { RommError, normaliseBaseUrl } from '../romm.ts'
import type { Handle } from './handler.ts'

/** Which server RomMix is signed in to, and how it got there. */
export function registerServerIpc(rommix: RomMixApp, handle: Handle): void {
  const { store, client } = rommix

  /** Current connection state, including who we are signed in as. */
  const status = async (): Promise<ConnectionStatus> => {
    const server = store.server
    const creds = store.credentials
    if (!server || (!creds.accessToken && !creds.clientToken)) {
      return {
        connected: false,
        baseUrl: server?.baseUrl ?? null,
        user: null,
        serverVersion: null,
        error: null
      }
    }
    try {
      const [user, beat] = await Promise.all([client.me(), client.heartbeat()])
      return {
        connected: true,
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
        baseUrl: server.baseUrl,
        user: null,
        serverVersion: null,
        error: (cause as Error).message
      }
    }
  }

  handle('server:status', status)

  handle('server:connect', async (payload: ConnectPayload): Promise<ConnectionStatus> => {
    const baseUrl = normaliseBaseUrl(payload.baseUrl)
    const previousServer = store.server

    // Confirm it is a RomM instance before we store anything.
    await client.heartbeat(baseUrl)
    store.setServer({ baseUrl, authMode: payload.mode, username: payload.username })

    try {
      if (payload.mode === 'password') {
        if (!payload.username || !payload.password) {
          throw new RommError('Username and password are required')
        }
        await client.loginWithPassword(payload.username, payload.password, baseUrl)
      } else if (payload.mode === 'token') {
        if (!payload.token) throw new RommError('An API token is required')
        client.setClientToken(payload.token)
      }
      // 'device' mode has already stored its token via pollPairing.

      const result = await status()
      if (!result.connected) throw new RommError(result.error ?? 'Could not sign in')
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
      store.setServer(previousServer)
      store.clearCredentials()
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
    await client.heartbeat(normalised)
    store.setServer({ baseUrl: normalised, authMode: 'device' })
    return client.startDevicePairing(normalised)
  })

  handle('server:pollPairing', async (deviceCode: string, baseUrl: string) =>
    client.pollDevicePairing(deviceCode, normaliseBaseUrl(baseUrl))
  )
}

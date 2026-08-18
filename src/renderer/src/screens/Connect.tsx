import { type JSX, useEffect, useRef, useState } from 'react'
import type { AuthMode, RommDeviceAuthInit } from '@shared/types'
import { FocusButton, Hints, Overlay, QrCode, SegmentedControl, TextField } from '../components'
import { useApp } from '../state'

/**
 * The server connection screen.
 *
 * Three ways in, in the order they suit a controller:
 *
 *  - Pairing: RomM issues a short code that the player approves from a phone or
 *    desktop browser. Nothing secret is ever typed on the TV.
 *  - API token: a long-lived `rmm_...` client token from RomM's admin page.
 *  - Username and password: the OAuth2 password grant.
 */
export function ConnectScreen(): JSX.Element {
  const { refreshStatus, navigate, notify, status } = useApp()

  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? '')
  const [mode, setMode] = useState<AuthMode>('device')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<RommDeviceAuthInit | null>(null)

  const finish = async (): Promise<void> => {
    const next = await refreshStatus()
    if (next.connected) {
      notify(`Connected to RomM as ${next.user?.username ?? 'user'}`)
      navigate({ name: 'home' })
    }
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.rommix.server.connect({ baseUrl, mode, username, password, token })
      await finish()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startPairing = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setPairing(await window.rommix.server.startPairing(baseUrl))
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content">
      <h1 className="page-title">Connect to RomM</h1>
      <p className="page-subtitle">
        Point RomMix at your RomM server to browse and download your library.
      </p>

      <div className="form">
        <TextField
          label="Server address"
          value={baseUrl}
          onChange={setBaseUrl}
          placeholder="https://romm.example.org"
          hint="The same address you use for the RomM web interface."
          autoFocus
        />

        <label className="field__label">How would you like to sign in?</label>
        <SegmentedControl<AuthMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'device', label: 'Pair this device' },
            { value: 'token', label: 'API token' },
            { value: 'password', label: 'Username & password' }
          ]}
        />

        {mode === 'device' ? (
          <p className="muted">
            RomMix shows a short code that you approve from RomM in any browser — no password typed
            on the couch.
          </p>
        ) : null}

        {mode === 'token' ? (
          <TextField
            label="API token"
            value={token}
            onChange={setToken}
            placeholder="rmm_…"
            type="password"
            hint="Create one in RomM under Administration → Client tokens."
          />
        ) : null}

        {mode === 'password' ? (
          <>
            <TextField label="Username" value={username} onChange={setUsername} />
            <TextField label="Password" value={password} onChange={setPassword} type="password" />
          </>
        ) : null}

        {error ? <div className="notice notice--error">{error}</div> : null}

        <div className="btn-row">
          {mode === 'device' ? (
            <FocusButton variant="primary" onSelect={() => void startPairing()} disabled={busy || !baseUrl}>
              {busy ? 'Contacting server…' : 'Start pairing'}
            </FocusButton>
          ) : (
            <FocusButton variant="primary" onSelect={() => void connect()} disabled={busy || !baseUrl}>
              {busy ? 'Connecting…' : 'Connect'}
            </FocusButton>
          )}
        </div>
      </div>

      {pairing ? (
        <PairingOverlay
          pairing={pairing}
          baseUrl={baseUrl}
          onCancel={() => setPairing(null)}
          onPaired={() => {
            setPairing(null)
            void connect()
          }}
          onError={(message) => {
            setPairing(null)
            setError(message)
          }}
        />
      ) : null}

      <Hints
        items={[
          { key: 'A', label: 'Select' },
          { key: '↕', label: 'Navigate' }
        ]}
      />
    </div>
  )
}

/**
 * Polls RomM until the user approves the pairing request.
 *
 * RomM tells us how often to poll and when the code expires; we honour both
 * rather than hammering the endpoint.
 */
function PairingOverlay({
  pairing,
  baseUrl,
  onCancel,
  onPaired,
  onError
}: {
  pairing: RommDeviceAuthInit
  baseUrl: string
  onCancel: () => void
  onPaired: () => void
  onError: (message: string) => void
}): JSX.Element {
  const [secondsLeft, setSecondsLeft] = useState(pairing.expires_in)
  const settled = useRef(false)

  useEffect(() => {
    settled.current = false
    const intervalMs = Math.max(pairing.interval, 1) * 1000
    const deadline = Date.now() + pairing.expires_in * 1000

    const tick = window.setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
    }, 1000)

    const poll = window.setInterval(() => {
      if (settled.current) return
      if (Date.now() > deadline) {
        settled.current = true
        onError('The pairing code expired. Try again.')
        return
      }
      void window.rommix.server
        .pollPairing(pairing.device_code, baseUrl)
        .then((approved) => {
          if (approved && !settled.current) {
            settled.current = true
            onPaired()
          }
        })
        .catch((cause: Error) => {
          settled.current = true
          onError(cause.message)
        })
    }, intervalMs)

    return () => {
      window.clearInterval(tick)
      window.clearInterval(poll)
    }
  }, [pairing, baseUrl, onPaired, onError])

  // The address is whatever was typed into the field, which may well have no
  // scheme — and a QR code of `romm.local/…` is one a phone cannot open. The
  // main process normalises the same way before it talks to the server.
  const origin = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`
  const verificationUrl = pairing.verification_path_complete.startsWith('http')
    ? pairing.verification_path_complete
    : `${origin.replace(/\/+$/, '')}${pairing.verification_path_complete}`

  return (
    <Overlay title="Approve this device">
      <p className="muted">
        Scan this with your phone, or open the address below on any device, then enter the code to
        let RomMix into your library.
      </p>

      <div className="pair-qr">
        <QrCode value={verificationUrl} />
      </div>

      <div className="pair-code">{pairing.user_code}</div>

      <dl className="kv">
        <dt>Open in a browser</dt>
        <dd>{verificationUrl}</dd>
        <dt>Code expires in</dt>
        <dd>
          {Math.floor(secondsLeft / 60)}m {secondsLeft % 60}s
        </dd>
      </dl>

      <div className="btn-row">
        <FocusButton onSelect={onCancel} autoFocus>
          Cancel
        </FocusButton>
      </div>
    </Overlay>
  )
}

import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react'
import type { AuthMode, RomStorage, RommDeviceAuthInit } from '@shared/types'
import { useAction } from '../../input/focus'
import {
  Choice,
  FocusButton,
  Hints,
  Overlay,
  QrCode,
  QuitOverlay,
  RomStorageChoice,
  SegmentedControl,
  TextField,
  UI_SCALES,
  uiScaleChoice,
  type UiScaleChoice
} from '../../components'
import { useApp } from '../../state'

/**
 * The steps of first-run setup, in order.
 *
 * Only two questions come before the server, and both earn their place by being
 * awkward to change *after* it. Scale is the one setting that decides whether
 * the next screen can be read at all from a sofa — asking it after the library
 * has loaded means asking it in text the user may not be able to see. And where
 * ROMs go decides where every download lands, so answering it later means
 * answering it with games already on disk in the other place.
 *
 * Everything else RomMix can be told stays in Settings. A wizard is a tax on
 * the first five minutes, and it is only worth charging for the questions whose
 * answers are expensive to revise.
 */
type SetupStep = 'scale' | 'storage' | 'server'

const SETUP_STEPS: readonly SetupStep[] = ['scale', 'storage', 'server']

/**
 * The server connection screen, and — on a fresh installation — the two
 * questions in front of it.
 *
 * Three ways in, in the order they suit a controller:
 *
 *  - Pairing: RomM issues a short code that the player approves from a phone or
 *    desktop browser. Nothing secret is ever typed on the TV.
 *  - API token: a long-lived `rmm_...` client token from RomM's admin page.
 *  - Username and password: the OAuth2 password grant.
 */
export function ConnectScreen(): JSX.Element {
  const { refreshStatus, replace, notify, status, settings, saveSettings } = useApp()

  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? '')
  const [mode, setMode] = useState<AuthMode>('device')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<RommDeviceAuthInit | null>(null)

  /**
   * Which page of setup is showing.
   *
   * Started from `setupComplete` rather than from "is a server configured":
   * signing out clears the server, and someone who has used RomMix for months
   * should be put back on the connect form, not walked through a page asking
   * how large they would like the text. Held as state so `null` — settings not
   * loaded yet — resolves once and does not then flip the page underneath
   * somebody mid-answer.
   */
  const [step, setStep] = useState<SetupStep | null>(null)
  useEffect(() => {
    if (settings && step === null) setStep(settings.setupComplete ? 'server' : 'scale')
  }, [settings, step])

  /**
   * B, which means two things on this screen and used to mean neither.
   *
   * Inside setup it steps back a page, the same thing the Back button does, so
   * the two agree. Outside it there is nowhere behind — this screen is the
   * bottom of the stack and has no menu bar to climb into — so it offers to
   * quit, which is what every console does when Back runs out. Before this it
   * was simply unbound, leaving a controller with no way out of RomMix at all
   * until a server had been configured.
   *
   * One binding rather than two: the shell deliberately leaves `back` alone on
   * this route, and a second handler registered here would shadow this one.
   */
  const [confirmingQuit, setConfirmingQuit] = useState(false)
  useAction('back', () => {
    if (step === 'server' && settings?.setupComplete === false) setStep('storage')
    else setConfirmingQuit(true)
  })

  const finish = async (): Promise<void> => {
    const next = await refreshStatus()
    if (next.connected) {
      // Recorded on the way through rather than at the end of the wizard: the
      // point of the flag is that these questions are asked once, and reaching
      // a working library is the moment that becomes true.
      if (settings && !settings.setupComplete) await saveSettings({ setupComplete: true })
      notify(`Connected to RomM as ${next.user?.username ?? 'user'}`)
      // Replaced rather than pushed: signing in is the start of a session, not
      // a step into one. Pushed, the connect form stays one B press behind the
      // home screen for the rest of the run.
      replace({ name: 'home' })
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

  // Nothing at all until the stored settings have arrived: a flash of the
  // wizard in front of someone who finished it a year ago is worse than a beat
  // of blank screen.
  if (!settings || step === null) return <div className="content" />

  const wizard = !settings.setupComplete
  const stepNumber = SETUP_STEPS.indexOf(step) + 1
  const at = (next: SetupStep): void => setStep(next)

  if (step === 'scale') {
    return (
      <SetupPage
        step={stepNumber}
        title="How big should RomMix be?"
        subtitle="Auto follows the screen — twice the size on a 4K television. Pick a size you can read from wherever you sit; you can change it later in Settings."
        onNext={() => at('storage')}
      >
        <Choice<UiScaleChoice>
          label="Scale"
          hint="The whole interface, not just the text."
          value={uiScaleChoice(settings.uiScale)}
          options={UI_SCALES}
          onChange={(next) => void saveSettings({ uiScale: next === 'auto' ? 0 : Number(next) })}
        />
      </SetupPage>
    )
  }

  if (step === 'storage') {
    return (
      <SetupPage
        step={stepNumber}
        title="Where should downloaded games go?"
        subtitle="This decides where every ROM lands, so it is far easier to answer now than once there are games on disk in the other place."
        onBack={() => at('scale')}
        onNext={() => at('server')}
      >
        <RomStorageChoice
          value={settings.romStorage}
          onChange={(next: RomStorage) => void saveSettings({ romStorage: next })}
        />
      </SetupPage>
    )
  }

  return (
    <div className="content">
      <h1 className="page-title">
        {wizard ? <span className="setup__step">Step {stepNumber} of 3</span> : null}
        Connect to RomM
      </h1>
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
          {/* Only during setup: outside it there is no page behind this one,
              and B is already bound to leaving the screen everywhere else. */}
          {wizard ? (
            <FocusButton icon="previous" variant="ghost" onSelect={() => at('storage')}>
              Back
            </FocusButton>
          ) : null}
          {mode === 'device' ? (
            <FocusButton
              icon="connect"
              variant="primary"
              onSelect={() => void startPairing()}
              disabled={busy || !baseUrl}
            >
              {busy ? 'Contacting server…' : 'Start pairing'}
            </FocusButton>
          ) : (
            <FocusButton
              icon="connect"
              variant="primary"
              onSelect={() => void connect()}
              disabled={busy || !baseUrl}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </FocusButton>
          )}
        </div>
      </div>

      {confirmingQuit ? <QuitOverlay onCancel={() => setConfirmingQuit(false)} /> : null}

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
          { key: '↕', label: 'Navigate' },
          { key: 'B', label: wizard ? 'Back' : 'Quit' }
        ]}
      />
    </div>
  )
}

/**
 * One page of first-run setup: a question, its control, and the way onwards.
 *
 * The two ends of the button row are deliberately the same shape as every other
 * screen's — back on the left, the thing you came to press on the right — so a
 * wizard does not become a fourth navigation model to learn. There is no Skip:
 * both questions have a default already selected, so Next *is* the skip.
 */
function SetupPage({
  step,
  title,
  subtitle,
  onBack,
  onNext,
  children
}: {
  step: number
  title: string
  subtitle: string
  onBack?: () => void
  onNext: () => void
  children: ReactNode
}): JSX.Element {
  // B goes back a page rather than out of the app: on the first page there is
  // nowhere behind, which is what leaving it unbound means.
  useAction('back', () => onBack?.(), Boolean(onBack))

  return (
    <div className="content">
      <h1 className="page-title">
        <span className="setup__step">
          Step {step} of {SETUP_STEPS.length}
        </span>
        {title}
      </h1>
      <p className="page-subtitle">{subtitle}</p>

      {children}

      <div className="btn-row">
        {onBack ? (
          <FocusButton icon="previous" variant="ghost" onSelect={onBack}>
            Back
          </FocusButton>
        ) : null}
        <FocusButton icon="next" variant="primary" onSelect={onNext} autoFocus>
          Next
        </FocusButton>
      </div>

      <Hints
        items={[
          { key: 'A', label: 'Select' },
          { key: '↕', label: 'Navigate' },
          ...(onBack ? [{ key: 'B', label: 'Back' }] : [])
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
        <FocusButton icon="cancel" onSelect={onCancel} autoFocus>
          Cancel
        </FocusButton>
      </div>
    </Overlay>
  )
}

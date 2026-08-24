import { type JSX, useState } from 'react'
import {
  Choice,
  FocusButton,
  Overlay,
  ScanToOpen,
  UI_SCALES,
  uiScaleChoice,
  type UiScaleChoice
} from '../../../components'
import { useApp } from '../../../state'

/**
 * The account, the size of the interface, and the two things done to RomMix
 * itself.
 *
 * The tab someone lands on, so it holds what is asked most and read most: who
 * you are signed in as, and how large this is drawn. Fullscreen and Quit are
 * here because they are one press each and belong nowhere else; the thank-you
 * is here because a settings page is where somebody who likes the thing looks.
 */

/**
 * Where to send someone who wants to say thank you.
 *
 * A QR code first and a browser second, in that order: RomMix is driven from a
 * sofa, and on a gamescope session there may be no browser for a link to open
 * into at all.
 */
const SUPPORT_URL = 'https://buymeacoffee.com/leclercb'

export function GeneralTab(): JSX.Element {
  const { status, settings, saveSettings, replace, notify } = useApp()
  const [supporting, setSupporting] = useState(false)

  const disconnect = async (): Promise<void> => {
    await window.rommix.server.disconnect()
    notify('Disconnected from RomM')
    // The end of a session, so the screens behind this one go with it: every
    // one of them is a view of a library there is no longer a server for.
    replace({ name: 'connect' })
  }

  return (
    <>
      <h2 className="section-title">Server</h2>
      <dl className="kv">
        <dt>Address</dt>
        <dd>{status?.baseUrl ?? 'Not configured'}</dd>
        <dt>Signed in as</dt>
        <dd>{status?.user?.username ?? '—'}</dd>
        <dt>RomM version</dt>
        <dd>{status?.serverVersion ?? 'unknown'}</dd>
      </dl>
      <div className="btn-row">
        <FocusButton icon="disconnect" variant="danger" onSelect={() => void disconnect()}>
          Disconnect
        </FocusButton>
      </div>

      <h2 className="section-title">Interface</h2>
      <Choice<UiScaleChoice>
        label="Scale"
        hint="Auto follows the screen: twice the size on a 4K television."
        value={uiScaleChoice(settings?.uiScale ?? 0)}
        options={UI_SCALES}
        onChange={(next) => void saveSettings({ uiScale: next === 'auto' ? 0 : Number(next) })}
      />

      <h2 className="section-title">Support RomMix</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        RomMix is free and always will be. If it saved you an afternoon of wiring emulators
        together, you can buy me a coffee.
      </p>
      <div className="btn-row">
        <FocusButton icon="coffee" onSelect={() => setSupporting(true)}>
          Buy me a coffee
        </FocusButton>
      </div>

      <h2 className="section-title">Application</h2>
      <div className="btn-row">
        <FocusButton
          icon="fullscreen"
          onSelect={() => void window.rommix.system.toggleFullscreen()}
        >
          Toggle fullscreen
        </FocusButton>
        <FocusButton icon="quit" variant="danger" onSelect={() => void window.rommix.system.quit()}>
          Quit RomMix
        </FocusButton>
      </div>

      {supporting ? (
        <Overlay title="Buy me a coffee">
          <p className="muted">
            Scan this with your phone, or open it in a browser on this machine.
          </p>
          <ScanToOpen url={SUPPORT_URL} />
          <div className="btn-row">
            <FocusButton icon="keep" onSelect={() => setSupporting(false)} autoFocus>
              Close
            </FocusButton>
            <FocusButton
              icon="homepage"
              onSelect={() => {
                setSupporting(false)
                void window.rommix.system.openExternal(SUPPORT_URL)
              }}
            >
              Open in a browser
            </FocusButton>
          </div>
        </Overlay>
      ) : null}
    </>
  )
}

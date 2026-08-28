import { type JSX, useState } from 'react'
import { LANGUAGE_FLAGS, LANGUAGE_NAMES, LOCALES, type LanguageChoice } from '@shared/i18n'
import {
  Choice,
  FocusButton,
  Overlay,
  ScanToOpen,
  Toggle,
  uiScaleChoice,
  uiScaleOptions,
  type UiScaleChoice
} from '../../../components'
import { useApp, useI18n } from '../../../state'

/**
 * The account, the size of the interface, and the two things done to RomMix
 * itself.
 *
 * The tab someone lands on, so it holds what is asked most and read most: who
 * you are signed in as, and how large — and in which language — this is drawn.
 * Fullscreen and Quit are here because they are one press each and belong
 * nowhere else; the thank-you is here because a settings page is where somebody
 * who likes the thing looks.
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
  const { t } = useI18n()
  const { status, settings, saveSettings, replace, notify } = useApp()
  const [supporting, setSupporting] = useState(false)

  const disconnect = async (): Promise<void> => {
    await window.rommix.server.disconnect()
    notify(t('settings.disconnected'))
    // The end of a session, so the screens behind this one go with it: every
    // one of them is a view of a library there is no longer a server for.
    replace({ name: 'connect' })
  }

  /**
   * Auto, then each language written in itself, behind a flag.
   *
   * Deliberately untranslated: somebody hunting for their own language is, by
   * definition, reading a list in one they may not have, and "Deutsch" is
   * recognisable from across a room in a way that "German" translated into
   * Spanish is not. The flag is quicker still — see `LANGUAGE_FLAGS`, which
   * says what it is and is not claiming.
   */
  const languages: { value: LanguageChoice; label: string }[] = [
    { value: 'auto', label: `🌐 ${t('value.auto')}` },
    ...LOCALES.map((locale) => ({
      value: locale,
      label: `${LANGUAGE_FLAGS[locale]} ${LANGUAGE_NAMES[locale]}`
    }))
  ]

  return (
    <>
      <h2 className="section-title">{t('settings.server')}</h2>
      <dl className="kv">
        <dt>{t('settings.address')}</dt>
        <dd>{status?.baseUrl ?? t('value.notConfigured')}</dd>
        <dt>{t('settings.signedInAs')}</dt>
        <dd>{status?.user?.username ?? '—'}</dd>
        <dt>{t('settings.rommVersion')}</dt>
        <dd>{status?.serverVersion ?? t('value.unknown')}</dd>
      </dl>
      <div className="btn-row">
        <FocusButton icon="disconnect" variant="danger" onSelect={() => void disconnect()}>
          {t('settings.disconnect')}
        </FocusButton>
      </div>

      <h2 className="section-title">{t('settings.interface')}</h2>
      <Choice<LanguageChoice>
        label={t('settings.language')}
        hint={t('settings.languageHint')}
        value={settings?.language ?? 'auto'}
        options={languages}
        onChange={(next) => void saveSettings({ language: next })}
      />
      <Choice<UiScaleChoice>
        label={t('control.scale')}
        hint={t('settings.scaleHint')}
        value={uiScaleChoice(settings?.uiScale ?? 0)}
        options={uiScaleOptions(t)}
        onChange={(next) => void saveSettings({ uiScale: next === 'auto' ? 0 : Number(next) })}
      />
      <Toggle
        label={t('settings.sounds')}
        hint={t('settings.soundsHint')}
        on={settings?.navigationSounds ?? true}
        onToggle={() => void saveSettings({ navigationSounds: !settings?.navigationSounds })}
      />

      <h2 className="section-title">{t('settings.support')}</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        {t('settings.supportBody')}
      </p>
      <div className="btn-row">
        <FocusButton icon="coffee" onSelect={() => setSupporting(true)}>
          {t('settings.buyCoffee')}
        </FocusButton>
      </div>

      <h2 className="section-title">{t('settings.application')}</h2>
      <div className="btn-row">
        <FocusButton
          icon="fullscreen"
          onSelect={() => void window.rommix.system.toggleFullscreen()}
        >
          {t('settings.toggleFullscreen')}
        </FocusButton>
        <FocusButton icon="quit" variant="danger" onSelect={() => void window.rommix.system.quit()}>
          {t('app.quitRomMix')}
        </FocusButton>
      </div>

      {supporting ? (
        <Overlay title={t('settings.buyCoffee')}>
          <p className="muted">{t('settings.scanOrOpen')}</p>
          <ScanToOpen url={SUPPORT_URL} />
          <div className="btn-row">
            <FocusButton icon="keep" onSelect={() => setSupporting(false)} autoFocus>
              {t('action.close')}
            </FocusButton>
            <FocusButton
              icon="homepage"
              onSelect={() => {
                setSupporting(false)
                void window.rommix.system.openExternal(SUPPORT_URL)
              }}
            >
              {t('action.openInBrowser')}
            </FocusButton>
          </div>
        </Overlay>
      ) : null}
    </>
  )
}

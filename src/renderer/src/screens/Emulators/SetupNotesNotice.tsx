import type { JSX } from 'react'
import { localize } from '@shared/i18n'
import type { EmulatorDescriptor } from '@shared/types'
import { FocusButton, Overlay } from '../../components'
import { useI18n } from '../../state'

/**
 * What is still to be done by hand, said at the moment the emulator arrives.
 *
 * These steps were only ever shown on a game's page, which is the right place
 * to be reminded and the wrong place to find out: by then somebody has chosen a
 * game, pressed Play, and is reading a warning instead of playing it. Every one
 * of them is something that, left undone, makes RomMix look broken — the
 * download is there and named, and the emulator's own list is empty.
 *
 * Installing is when the user is already thinking about this emulator and has
 * nothing else in flight, so it is the cheapest moment to spend their attention.
 * The game page keeps its copy, dismissible per emulator, for the times this
 * one was closed without being read.
 *
 * An emulator with nothing to say never raises this — see `EmulatorList`, which
 * falls back to the notification it always showed.
 *
 * Also opened from the button on the emulator's own row, long after it arrived.
 * The title is the one thing that differs: at install time the news is that it
 * worked, and later it is what is left to do.
 */
export function SetupNotesNotice({
  emulator,
  installed = false,
  onClose
}: {
  emulator: EmulatorDescriptor
  /** True when this is the confirmation that it has just been installed. */
  installed?: boolean
  onClose: () => void
}): JSX.Element {
  const i18n = useI18n()
  const { t } = i18n

  return (
    <Overlay
      title={t(installed ? 'emulator.installedTitle' : 'emulator.setupTitle', {
        name: emulator.name
      })}
      icon="note"
    >
      <p className="muted">{t('emulator.setupIntro', { name: emulator.name })}</p>
      <ul className="notice__list muted">
        {emulator.setupNotes.map((note) => (
          <li key={typeof note === 'string' ? note : note.key}>{localize(note, i18n)}</li>
        ))}
      </ul>
      <div className="btn-row">
        <FocusButton icon="confirm" variant="primary" onSelect={onClose} autoFocus>
          {t('action.close')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

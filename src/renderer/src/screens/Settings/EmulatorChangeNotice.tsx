import type { JSX } from 'react'
import { FocusButton, Overlay } from '../../components'

/**
 * What changing the emulator for a platform actually costs, and the two ways
 * of agreeing to it.
 *
 * Every emulator keeps its own BIOS folder, its own save tree, and — unless
 * games live in RomMix's shared folder — its own copy of every ROM. None of
 * that follows the platform across, so a reorder that looks like a preference
 * is in fact a re-download. Said before it happens rather than discovered
 * afterwards as a library that has apparently emptied itself.
 *
 * Dismissible, because someone arranging five emulators will see this five
 * times and the second time it is already noise.
 */
export function EmulatorChangeNotice({
  sharedRoms,
  onConfirm,
  onCancel
}: {
  sharedRoms: boolean
  onConfirm: (dontAskAgain: boolean) => void
  onCancel: () => void
}): JSX.Element {
  return (
    <Overlay title="Change which emulator runs this?">
      <p className="muted">
        Each emulator keeps its own files, and nothing moves across when you change one:
      </p>
      <ul className="notice__list muted">
        <li>BIOS files have to be installed again for the new emulator.</li>
        <li>
          {sharedRoms
            ? 'Games stay where they are — they are in RomMix’s own folder, which you point every emulator at.'
            : 'Downloaded games stay in the old emulator’s folder and have to be downloaded again.'}
        </li>
        <li>Saves live in the old emulator&apos;s tree. Pull them from RomM after the change.</li>
      </ul>
      <div className="btn-row">
        <FocusButton icon="confirm" variant="primary" onSelect={() => onConfirm(false)} autoFocus>
          Change it
        </FocusButton>
        <FocusButton icon="hide" onSelect={() => onConfirm(true)}>
          Change it, don&apos;t ask again
        </FocusButton>
        <FocusButton icon="cancel" variant="ghost" onSelect={onCancel}>
          Cancel
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** The dismissal key for `EmulatorChangeNotice`, in `Settings.dismissedNotices`. */
export const EMULATOR_CHANGE_NOTICE = 'emulator-change'

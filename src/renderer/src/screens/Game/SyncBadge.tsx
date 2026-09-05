import type { JSX } from 'react'
import type { MessageKey } from '@shared/i18n'
import type { PendingSave, SaveSyncState } from '@shared/types'
import { Icon, type IconName } from '../../icons'
import { useI18n } from '../../state'

/**
 * How each sync state reads on a row.
 *
 * The label says which side is ahead, not what to press: the buttons that move
 * saves move everything at once, so a per-row instruction would be promising an
 * action that does not exist. `hint` is the same thing at length, on hover.
 *
 * The colour says which way the file would move, and only that: amber for the
 * ones this device holds and the server may not, the accent for the ones RomM
 * has and this device does not, green where the two agree and red where they
 * never will. Two rows to a colour is the point — the colour carries the
 * direction across a room and the label supplies the degree, where the amber
 * that used to cover both directions could be read only by reading it.
 *
 * Nothing is grey. `off` said "there is nothing here" about a file the server is
 * holding, which is the one thing it is not.
 */
const SYNC_BADGES: Record<
  SaveSyncState,
  { label: MessageKey; tone: 'ok' | 'warn' | 'info' | 'bad'; icon: IconName; hint: MessageKey }
> = {
  synced: { label: 'saves.synced', tone: 'ok', icon: 'confirm', hint: 'saves.syncedHint' },
  'local-newer': {
    label: 'saves.localNewer',
    tone: 'warn',
    icon: 'push',
    hint: 'saves.localNewerHint'
  },
  'local-only': {
    label: 'saves.localOnly',
    tone: 'warn',
    icon: 'push',
    hint: 'saves.localOnlyHint'
  },
  'remote-newer': {
    label: 'saves.remoteNewer',
    tone: 'info',
    icon: 'pull',
    hint: 'saves.remoteNewerHint'
  },
  'remote-only': {
    label: 'saves.remoteOnly',
    tone: 'info',
    icon: 'pull',
    hint: 'saves.remoteOnlyHint'
  },
  // No arrow on this one: every other badge points at the end that is ahead,
  // and the whole of what this one says is that nobody knows which that is.
  // Amber all the same — the file is here, its server copy is unaccounted for,
  // and that is the same unfinished business as the two above it.
  unchecked: { label: 'saves.unchecked', tone: 'warn', icon: 'saves', hint: 'saves.uncheckedHint' }
}

/**
 * The sixth badge, which is not a sync state at all.
 *
 * Every entry above says which end is ahead; this one says the question does
 * not arise, because RomM's tag names an emulator this game is not set to run
 * under and a pull will step over the row whichever end is ahead.
 *
 * It reads "Incompatible" rather than naming the cause, because the chip beside
 * it already names the emulator: the badge is then the consequence and the chip
 * the reason, where two labels for the same fact would only say it twice. True
 * as written, and only because of where this appears — a state and a save
 * folder really are one program's, which is why they are the two the tag
 * decides for. Kept beside
 * them rather than inside `SaveSyncState`, which is about newness alone —
 * folding "cannot be loaded here" into it would make one field answer two
 * questions and every `syncStateOf` call decide something it cannot see.
 */
const OTHER_EMULATOR: (typeof SYNC_BADGES)[SaveSyncState] = {
  label: 'saves.otherEmulator',
  // The strongest colour on the row, and the only one that earns it: every
  // other badge is a file on its way somewhere, and this is the one that is
  // going nowhere. `bad` reads as "this will not happen" rather than "this
  // failed" — the stopped download it was written for is the same shape.
  tone: 'bad',
  icon: 'saves',
  hint: 'saves.otherEmulatorHint'
}

/**
 * Which side is ahead, as one chip.
 *
 * A component rather than the table alone, because two lists draw it — the
 * Saves tab and the push confirmation — and a badge that differed between the
 * two would be saying that a file listed in both is two different things.
 */
export function SyncBadge({
  sync,
  forAnotherEmulator = false
}: {
  sync: SaveSyncState
  forAnotherEmulator?: boolean
}): JSX.Element {
  const { t } = useI18n()
  /**
   * A row a pull will leave where it is, whichever side is ahead.
   *
   * The badge above answers "which button, if any, would do something about
   * this row", and for these the answer is none — so it says that instead of
   * which end has it. Down to the icon: `remote-newer` draws an arrow inviting
   * the very pull that would skip this file, which is the badge promising
   * something on the tag's behalf that the tag is the reason against. The
   * emulator chip beside it names the one that wrote it.
   */
  const badge = forAnotherEmulator ? OTHER_EMULATOR : SYNC_BADGES[sync]
  return (
    <span className="status status--badge" data-state={badge.tone} title={t(badge.hint)}>
      <Icon name={badge.icon} size={13} />
      {t(badge.label)}
    </span>
  )
}

/**
 * A file a push would send, as the sync state it is in.
 *
 * Three of the five, and the push preview can be in no others: it lists local
 * files, so neither `remote-only` nor — the server's copy having already been
 * compared — `synced` can appear. Derived rather than carried on `PendingSave`,
 * so the dialog and the tab cannot disagree about one file: both are reading
 * `isNewer`, which `previewPush` decides with the same `syncStateOf` the tab's
 * own rows come from.
 */
export function pushSyncState(file: PendingSave): SaveSyncState {
  if (!file.replaces) return 'local-only'
  return file.replaces.isNewer ? 'remote-newer' : 'local-newer'
}

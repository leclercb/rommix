import { type JSX, type Ref } from 'react'
import type { MessageKey } from '@shared/i18n'
import type { RomUserStatus } from '@shared/types'
import { FocusButton, Overlay } from '../../components'
import { Icon, type IconName } from '../../icons'
import { useFocusable } from '../../input/focus'
import { useI18n } from '../../state'

/**
 * How far through the game the player says they are.
 *
 * One of a fixed few rather than a toggle, so a list of them is the honest
 * shape — and a list is what a controller walks. Pressing one closes the
 * dialog: unlike the collections beside it, a game has exactly one answer here,
 * so there is nothing further to say once it is given.
 *
 * Kept on RomM rather than in RomMix, which is the point of it: a game marked
 * finished from the sofa is finished in a browser and on the handheld too.
 */

/**
 * RomM's five, in the order somebody moves through them, and the way out.
 *
 * The colour is the same one the rest of the interface uses for a state of that
 * kind — the accent for something under way, green for something done, amber
 * for something abandoned, grey for nothing. Finished and completed share a
 * colour because they are the same answer told to different depths, and the
 * words are what separate them.
 */
const CHOICES: readonly {
  value: RomUserStatus | null
  label: MessageKey
  tone: 'ok' | 'warn' | 'info' | 'off'
  icon: IconName
}[] = [
  { value: 'incomplete', label: 'status.incomplete', tone: 'info', icon: 'play' },
  { value: 'finished', label: 'status.finished', tone: 'ok', icon: 'confirm' },
  // A star for the one that goes further than finished, which is the only
  // difference between the two and the only thing the marks have to carry.
  { value: 'completed_100', label: 'status.completed_100', tone: 'ok', icon: 'rating' },
  { value: 'retired', label: 'status.retired', tone: 'warn', icon: 'cancel' },
  { value: 'never_playing', label: 'status.never_playing', tone: 'off', icon: 'hide' },
  // Last, and offered always: a status set by accident is otherwise permanent
  // from here, and RomM's own field is nullable.
  { value: null, label: 'status.none', tone: 'off', icon: 'clear' }
]

/**
 * How far through a game somebody is, as a word with a colour behind it.
 *
 * Shaped like the chips it sits above — the platform, the year, `Downloaded` —
 * because it belongs to the same line of things said about the game, and a
 * second shape for one of them would read as a different kind of fact. Only the
 * colour changes with the answer.
 */
export function StatusTag({ status }: { status: RomUserStatus | null }): JSX.Element | null {
  const { t } = useI18n()
  const choice = CHOICES.find((entry) => entry.value === status)
  if (!choice) return null

  return (
    <span className="chip chip--icon chip--status" data-state={choice.tone}>
      <Icon name={choice.icon} size={14} />
      {t(choice.label)}
    </span>
  )
}

export function StatusDialog({
  current,
  onChoose,
  onClose
}: {
  current: RomUserStatus | null
  onChoose: (status: RomUserStatus | null) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <Overlay title={t('status.dialogTitle')} icon="confirm">
      <ul className="asset-list">
        {CHOICES.map((choice) => (
          <StatusRow
            key={choice.value ?? 'none'}
            status={choice.value}
            label={t(choice.label)}
            chosen={choice.value === current}
            onSelect={() => onChoose(choice.value)}
          />
        ))}
      </ul>

      <div className="btn-row">
        <FocusButton icon="back" action="close-status" onSelect={onClose}>
          {t('action.close')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** One answer, drawn as the tag it would put on the game. */
function StatusRow({
  status,
  label,
  chosen,
  onSelect
}: {
  status: RomUserStatus | null
  /** The same word the tag carries, for the hint bar and for assistive tech. */
  label: string
  chosen: boolean
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({
    onSelect,
    actionLabel: label,
    // Focus opens on the answer already given, so the dialog opens where the
    // player left it rather than at the top of a list they have to read.
    autoFocus: chosen
  })

  return (
    <li
      ref={ref as Ref<HTMLLIElement>}
      data-status={status ?? 'none'}
      aria-current={chosen}
      {...props}
    >
      {/* The row is the tag it is about to put on the game, so the colour is
          learnt by choosing rather than by being explained. */}
      <StatusTag status={status} />
      {/* A mark on the one that is already set, and nothing at all on the rest:
          an icon on every row invites the question of what pressing it adds. */}
      {chosen ? <Icon name="confirm" size={15} /> : null}
    </li>
  )
}

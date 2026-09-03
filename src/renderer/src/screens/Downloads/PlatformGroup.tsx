import type { JSX, Ref } from 'react'
import type { InstalledRom } from '@shared/types'
import { SystemIcon } from '../../components'
import { Icon } from '../../icons'
import { useFocusable } from '../../input/focus'
import { useI18n } from '../../state'
import { InstalledRow } from './InstalledRow'

/**
 * One platform, collapsed to a single row until asked.
 *
 * Closed, a library of four hundred games is fifteen rows — which is the whole
 * point: on a D-pad the only way past a row is through it, so every game that
 * is on screen and not being looked for is a button press spent. The header
 * carries what the group is worth answering without opening it (how many, how
 * much disk), so the collapsed view is useful on its own rather than being a
 * lid over the useful thing.
 */
export function PlatformGroup({
  system,
  entries,
  open,
  onToggle,
  onOpenGame,
  onRemove
}: {
  system: string
  entries: InstalledRom[]
  open: boolean
  onToggle: () => void
  onOpenGame: (entry: InstalledRom) => void
  onRemove: (entry: InstalledRom) => void
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { ref, props } = useFocusable({
    onSelect: onToggle,
    actionLabel: open ? t('action.collapse') : t('action.expand')
  })
  const size = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)

  return (
    <section className="group">
      <div ref={ref as Ref<HTMLDivElement>} className="group__header" data-open={open} {...props}>
        <span className="group__chevron">
          <Icon name={open ? 'collapse' : 'expand'} size={16} />
        </span>
        <SystemIcon system={system} size={30} />
        <span className="group__name">{entries[0].platformName}</span>
        <span className="group__meta">
          {t('downloads.groupMeta', { count: entries.length, size: formatBytes(size) })}
        </span>
      </div>

      {open
        ? entries.map((entry) => (
            <InstalledRow
              key={entry.romId}
              entry={entry}
              onSelect={() => onOpenGame(entry)}
              // The same rule as the game screen: this button is one A press
              // away from deleting a game, so it asks unless the user has
              // turned confirmation off.
              onRemove={() => onRemove(entry)}
            />
          ))
        : null}
    </section>
  )
}

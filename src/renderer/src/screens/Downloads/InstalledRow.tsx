import type { JSX, Ref } from 'react'
import type { InstalledRom } from '@shared/types'
import { CoverArt, FocusButton, SystemIcon } from '../../components'
import { useFocusable } from '../../input/focus'
import { useI18n } from '../../state'

/**
 * One installed game: the name RomM knows it by, its cover for recognition, and
 * every file it is made of underneath, so a multi-disc set is visibly more than
 * one file.
 */
export function InstalledRow({
  entry,
  onSelect,
  onRemove
}: {
  entry: InstalledRom
  onSelect: () => void
  onRemove: () => void
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { ref, props } = useFocusable({ onSelect, actionLabel: t('action.open') })
  const title = entry.name
  const files = entry.files

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="installed" {...props}>
      <div className="installed__art">
        <CoverArt path={entry.coverPath ?? null} name={title} />
      </div>

      <div className="installed__body">
        <div className="installed__title">{title}</div>
        <div className="installed__meta">
          <SystemIcon system={entry.system} size={22} />
          <span>{entry.platformName}</span>
          <span>·</span>
          <span>{formatBytes(entry.sizeBytes)}</span>
          {files.length > 1 ? (
            <span>· {t('downloads.fileCount', { count: files.length })}</span>
          ) : null}
        </div>
        <ul className="installed__files">
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      </div>

      <div className="installed__actions">
        <FocusButton icon="uninstall" variant="danger" onSelect={onRemove}>
          {t('action.uninstall')}
        </FocusButton>
      </div>
    </div>
  )
}

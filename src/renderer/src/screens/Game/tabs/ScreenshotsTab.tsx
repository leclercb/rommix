import type { JSX } from 'react'
import type { RommRom } from '@shared/types'
import { useI18n } from '../../../state'

export function ScreenshotsTab({ rom }: { rom: RommRom }): JSX.Element {
  const { t } = useI18n()
  const shots = rom.merged_screenshots ?? []
  if (shots.length === 0) {
    return <div className="empty">{t('shots.empty')}</div>
  }
  return (
    <div className="shots">
      {shots.map((path) => (
        <img
          key={path}
          className="shot"
          src={window.rommix.system.imageUrl(path) ?? undefined}
          alt=""
          loading="lazy"
        />
      ))}
    </div>
  )
}

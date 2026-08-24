import type { JSX } from 'react'
import type { RommRom } from '@shared/types'

export function ScreenshotsTab({ rom }: { rom: RommRom }): JSX.Element {
  const shots = rom.merged_screenshots ?? []
  if (shots.length === 0) {
    return <div className="empty">RomM has no screenshots for this game.</div>
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

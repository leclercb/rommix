import { useEffect, useState, type JSX } from 'react'
import type { DriveSpace } from '@shared/types'
import { ProgressBar } from '../../components'
import { useI18n } from '../../state'

/**
 * How much room is left where the games go.
 *
 * On this tab because this is the screen about what is on the disk: every other
 * figure here is a game's size, and the one question those add up to is whether
 * there is room for another. The pre-flight check says the same thing for
 * somebody diagnosing a machine rather than filling it.
 *
 * One row per drive, and usually one row: downloads go to a single RomMix
 * folder unless each emulator keeps its own library, and those are typically on
 * the same disk. See `drivesOf`, which is what decides that two folders are one
 * drive.
 */
export function Drives(): JSX.Element | null {
  const { t, formatBytes } = useI18n()
  const [drives, setDrives] = useState<DriveSpace[]>([])

  // Asked once, when the tab is opened. A figure that ticked would be a poll of
  // the filesystem for the length of the session, and the thing that changes it
  // — a download landing — is not something this screen can miss: it is the
  // screen the download is watched from, and coming back to it asks again.
  useEffect(() => {
    void window.rommix.system
      .drives()
      .then(setDrives)
      // Nothing: a drive that will not answer is one RomMix says nothing about,
      // and an error notification about a figure nobody asked for is noise.
      .catch(() => setDrives([]))
  }, [])

  if (drives.length === 0) return null

  return (
    <div className="drives">
      {drives.map((drive) => {
        const used = drive.totalBytes - drive.freeBytes
        return (
          <div className="drive" key={drive.path} data-drive={drive.path}>
            <div className="drive__line">
              <span className="drive__free">
                {t('downloads.driveFree', { free: formatBytes(drive.freeBytes) })}
              </span>
              <span className="drive__total">
                {t('downloads.driveOf', { total: formatBytes(drive.totalBytes) })}
              </span>
              {/* The folder rather than the mount point: it is the answer to
                  "which drive", in the terms the user set it in. Only worth
                  saying where there is more than one. */}
              {drives.length > 1 ? <span className="drive__path">{drive.path}</span> : null}
            </div>
            <ProgressBar percent={(used / drive.totalBytes) * 100} />
          </div>
        )
      })}
    </div>
  )
}

import type { JSX } from 'react'
import type { InstalledRom, RommRom } from '@shared/types'
import { formatBytes } from '../../../components'
import { Icon } from '../../../icons'

/**
 * The files the game is made of, on the server and on this device.
 *
 * Both, because they are not always the same: RomM zips a multi-file game for
 * transport and RomMix unpacks it, so a two-file cue+bin on the server is two
 * files in a directory here — and a game whose local copy has lost a track is
 * a thing you can only see by comparing the two.
 */
export function FilesTab({ rom, entry }: { rom: RommRom; entry?: InstalledRom }): JSX.Element {
  const local = entry?.files?.length ? entry.files : entry ? [entry.fileName] : []

  return (
    <>
      <h3 className="section-title" style={{ fontSize: 17 }}>
        On the server
      </h3>
      {rom.files.length === 0 ? (
        <div className="empty">RomM lists no files for this game.</div>
      ) : (
        <ul className="asset-list">
          {rom.files.map((file) => (
            <li key={file.id}>
              <span className="asset__icon">
                <Icon name="file" size={17} />
              </span>
              <span className="asset__name">{file.file_name}</span>
              <span className="asset__meta">{formatBytes(file.file_size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title" style={{ fontSize: 17 }}>
        On this device
      </h3>
      {local.length === 0 ? (
        <div className="empty">Not downloaded.</div>
      ) : (
        <ul className="asset-list">
          {local.map((file) => (
            <li key={file}>
              <span className="asset__icon">
                <Icon name="file" size={17} />
              </span>
              <span className="asset__name">{file}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

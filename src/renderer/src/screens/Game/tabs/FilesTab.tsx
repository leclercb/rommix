import { type JSX, useEffect, useState } from 'react'
import { fileNameOf, type GameFile } from '@shared/gamefiles'
import type { MessageKey } from '@shared/i18n'
import type { InstalledRom, RommRom } from '@shared/types'
import { Icon, type IconName } from '../../../icons'
import { useI18n } from '../../../state'

/**
 * The files the game is made of, and which side each one is on.
 *
 * One list rather than two, for the same reason the saves tab is one list: the
 * question is about a file, and "is it here, is it on the server, or both" is
 * the answer — not something to work out by reading two lists and comparing
 * them by eye.
 *
 * The two do come apart. RomM zips a multi-file game for transport and RomMix
 * unpacks it, so a cue+bin on the server is two files in a directory here, and
 * a local copy that has lost a track shows as a file the server has and this
 * device does not.
 */

/** How each side reads on a row. */
const WHERE: Record<
  'both' | 'server' | 'device',
  { label: MessageKey; hint: MessageKey; tone: 'ok' | 'warn' | 'info'; icon: IconName }
> = {
  both: { label: 'files.tagBoth', hint: 'files.hintBoth', tone: 'ok', icon: 'confirm' },
  server: { label: 'files.tagServer', hint: 'files.hintServer', tone: 'info', icon: 'server' },
  device: { label: 'files.tagDevice', hint: 'files.hintDevice', tone: 'warn', icon: 'folder' }
}

/** One file, wherever it is. `sizeBytes` is the server's, null when it has none. */
interface FileRow {
  name: string
  where: 'both' | 'server' | 'device'
  sizeBytes: number | null
}

/**
 * Both sides as one list, matched by name.
 *
 * Case-insensitively, as everything else that matches a file name here is:
 * what a server holds as `Game.CUE` and an emulator wrote as `game.cue` is one
 * file, and listing it twice would invent a discrepancy.
 */
function merge(rom: RommRom, entry: InstalledRom | undefined): FileRow[] {
  const local = entry?.files?.length ? entry.files : entry ? [fileNameOf(entry.path)] : []
  const here = new Map(local.map((name) => [name.toLowerCase(), name]))
  const rows: FileRow[] = []

  for (const file of rom.files) {
    const key = file.file_name.toLowerCase()
    rows.push({
      name: file.file_name,
      where: here.has(key) ? 'both' : 'server',
      sizeBytes: file.file_size_bytes
    })
    here.delete(key)
  }

  // Whatever is left is on this disk and not in the server's list.
  for (const name of here.values()) rows.push({ name, where: 'device', sizeBytes: null })

  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export function FilesTab({ rom, entry }: { rom: RommRom; entry?: InstalledRom }): JSX.Element {
  const { t, formatBytes } = useI18n()
  const rows = merge(rom, entry)
  /**
   * What the copies on this disk weigh, by lowercased name.
   *
   * Asked of the main process rather than taken from the installed entry,
   * which carries one total for the whole game: a file the server does not
   * have has no other size to show, and a row with a blank where every other
   * row has a figure reads as a file with nothing in it.
   */
  const [local, setLocal] = useState<Map<string, number>>(new Map())
  // Read out before the effect, so what it depends on is what it uses.
  const romId = rom.id
  const installed = entry !== undefined
  useEffect(() => {
    setLocal(new Map())
    if (!installed) return
    void window.rommix.library
      .files(romId)
      .then((files: GameFile[]) =>
        setLocal(new Map(files.map((file) => [file.name.toLowerCase(), file.sizeBytes])))
      )
      // A stat that fails leaves the sizes off, not an error over the list.
      .catch(() => setLocal(new Map()))
  }, [romId, installed])

  if (rows.length === 0) return <div className="empty">{t('files.empty')}</div>

  return (
    <ul className="asset-list">
      {rows.map((row) => {
        const where = WHERE[row.where]
        const sizeBytes = row.sizeBytes ?? local.get(row.name.toLowerCase()) ?? null
        return (
          <li key={`${row.where}-${row.name}`}>
            <span className="asset__icon">
              <Icon name="file" size={17} />
            </span>
            <span className="status status--badge" data-state={where.tone} title={t(where.hint)}>
              <Icon name={where.icon} size={13} />
              {t(where.label)}
            </span>
            <span className="asset__name">{row.name}</span>
            <span className="asset__meta">{sizeBytes === null ? '' : formatBytes(sizeBytes)}</span>
          </li>
        )
      })}
    </ul>
  )
}

import type { JSX } from 'react'
import { emulatorById } from '@config/emulators'
import { SHARED_LIBRARY } from '@shared/types'
import type { InstalledRom, RommRom } from '@shared/types'
import { Icon, type IconName } from '../../../icons'
import { useI18n } from '../../../state'

/** One fact about the game: what to draw beside it, what to call it, its value. */
type Fact = { icon: IconName; label: string; value: string | null }

/**
 * Everything about the game that is not a file and not artwork.
 *
 * Three groups, in the order they are wanted: what the game is, which dump of
 * it this is, and where this copy of it lives. Nothing the page already says
 * gets a row — the filename is the Files tab's whole subject, and platform,
 * rating, year, region, revision, size and genre are all in the banner — so
 * what is left here is only what cannot be read anywhere else.
 *
 * Built as a list and filtered rather than written as conditional rows: RomM's
 * metadata is only as complete as the provider a game was matched against, and
 * a homebrew ROM matched to nothing would otherwise leave an empty tab, which
 * reads as a failure rather than as an absence.
 */
export function DetailsTab({ rom, entry }: { rom: RommRom; entry?: InstalledRom }): JSX.Element {
  const { t, formatBytes, formatDate, formatDateTime } = useI18n()
  const meta = rom.metadatum
  const list = (values: string[]): string | null => (values.length > 0 ? values.join(', ') : null)
  const at = (value: string | null): string | null => formatDateTime(value)

  const facts: Fact[] = [
    { icon: 'company', label: t('details.company'), value: list(meta.companies) },
    { icon: 'franchise', label: t('details.series'), value: list(meta.franchises) },
    {
      icon: 'time',
      label: t('details.released'),
      value: meta.first_release_date ? formatDate(meta.first_release_date) : null
    },
    // Worth knowing before starting something with a second person in the room,
    // and the one pair of facts RomM holds that nothing else on this page shows.
    {
      icon: 'players',
      label: t('details.players'),
      value: meta.player_count && meta.player_count !== '0' ? meta.player_count : null
    },
    { icon: 'modes', label: t('details.modes'), value: list(meta.game_modes) },

    // Which dump this is. Region and revision are chips in the banner; what is
    // left is the language it can be read in and the tags two files of the same
    // game tell themselves apart by.
    { icon: 'languages', label: t('details.languages'), value: list(rom.languages) },
    { icon: 'tags', label: t('details.tags'), value: list(rom.tags) },

    { icon: 'play', label: t('details.lastPlayed'), value: at(rom.rom_user.last_played) },
    // The folder to open to find this game: its own directory when it was
    // unpacked into one, otherwise the system folder it sits in. Not the
    // filename — that is the Files tab, in full, for both ends.
    {
      icon: 'folder',
      label: t('details.installedTo'),
      value: entry ? (entry.isDirectory ? entry.path : entry.path.replace(/\/[^/]*$/, '')) : null
    },
    { icon: 'systemFolder', label: t('details.systemFolder'), value: entry?.system ?? null },
    // Which library holds this copy. It is the reason a game can be on disk and
    // still offered as a download: pointing the platform at another emulator
    // does not move the file. A game in the shared tree is not held for any
    // emulator in particular, and says so.
    {
      icon: 'emulator',
      label: t('details.downloadedFor'),
      value: !entry
        ? null
        : entry.emulatorId === SHARED_LIBRARY
          ? t('details.romMixFolder')
          : (emulatorById(entry.emulatorId)?.name ?? entry.emulatorId)
    },
    // What it takes up here, which is not the size on the chip beside the
    // cover: RomM sends a multi-file game as one zip and RomMix unpacks it.
    {
      icon: 'size',
      label: t('details.onDisk'),
      value: entry ? formatBytes(entry.sizeBytes) : null
    },
    {
      icon: 'download',
      label: t('details.downloaded'),
      value: entry ? at(entry.installedAt) : null
    }
  ]

  const shown = facts.filter((fact) => fact.value !== null)
  if (shown.length === 0) {
    return <div className="empty">{t('details.empty')}</div>
  }

  return (
    // Each pair in a wrapper of its own rather than as loose siblings: that is
    // what lets the list run in two columns where there is room for two, since
    // a bare dt/dd stream has nothing for a grid to keep together.
    <dl className="kv kv--columns">
      {shown.map((fact) => (
        <div className="kv__row" key={fact.label}>
          {/* The icon marks the label it sits with — the word is right there —
              so it keeps the label's dim colour rather than competing with the
              value, which is the part being read. */}
          <dt>
            <Icon name={fact.icon} size={16} />
            {fact.label}
          </dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

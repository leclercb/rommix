import { type JSX, type Ref, useEffect, useState } from 'react'
import type { RommRom, RommSiblingRom } from '@shared/types'
import { StatusBadge } from '../../../components'
import { Icon } from '../../../icons'
import { useFocusable } from '../../../input/focus'
import { useI18n } from '../../../state'

/**
 * Every dump of this game, this one included.
 *
 * What a grouped grid owes the person using it: one tile stands for three
 * files, and without somewhere to say which three, the European copy of a game
 * has simply gone from the library. Including the copy being looked at, marked,
 * because the question is which of them to play rather than what else exists —
 * and the answer is only readable against the one already open.
 *
 * A sibling arrives as names alone, so the rest of each row is fetched when the
 * tab is opened rather than with the game: choosing between two dumps on
 * `(USA)` against `(Europe) (Rev A)` is choosing on a filename, and region,
 * revision and size are the facts the choice is actually made on. A handful of
 * requests, made only when somebody looks — and the rows are drawn from the
 * names first, so the list is never a spinner.
 *
 * Each row is named by its file rather than by the tags that distinguish it.
 * The tags are the shorter label and were the obvious one, until a dump that
 * carries none — which is most base releases — left a row with nothing to be
 * called: one row read as a label and the next as a filename. The file name is
 * a thing every dump has, and the chips beside it say what it is.
 */
export function VersionsTab({
  rom,
  siblings,
  installedIds,
  onOpen
}: {
  rom: RommRom
  siblings: readonly RommSiblingRom[]
  installedIds: Set<number>
  onOpen: (romId: number) => void
}): JSX.Element {
  const [details, setDetails] = useState<Map<number, RommRom>>(new Map())

  useEffect(() => {
    setDetails(new Map())
    let listening = true
    void Promise.all(
      // A version RomM will not describe keeps its row and loses its chips: the
      // name is what the row acts on, and it is already here.
      siblings.map((sibling) => window.rommix.library.rom(sibling.id).catch(() => null))
    ).then((fetched) => {
      if (!listening) return
      setDetails(new Map(fetched.filter((row) => row !== null).map((row) => [row.id, row])))
    })
    return () => {
      listening = false
    }
  }, [siblings])

  /**
   * The dumps in one list, ordered by the name on disk.
   *
   * By name rather than by which is the server's main sibling or which is open:
   * the order has to stay put as the tab is walked back into from a version it
   * opened, or the list reshuffles itself under whoever is choosing.
   */
  const rows = [
    { id: rom.id, fsNameNoExt: rom.fs_name_no_ext },
    ...siblings.map((sibling) => ({ id: sibling.id, fsNameNoExt: sibling.fs_name_no_ext }))
  ].sort((one, other) => one.fsNameNoExt.localeCompare(other.fsNameNoExt))

  return (
    <ul className="asset-list">
      {rows.map((row) => (
        <VersionRow
          key={row.id}
          romId={row.id}
          fsNameNoExt={row.fsNameNoExt}
          detail={row.id === rom.id ? rom : details.get(row.id)}
          current={row.id === rom.id}
          installed={installedIds.has(row.id)}
          onSelect={() => onOpen(row.id)}
        />
      ))}
    </ul>
  )
}

/**
 * One dump, as a row that is pressed rather than a row with a button on it.
 *
 * The whole row is the target because the whole row is the subject: there is
 * one thing to do with a version and it is to go to it, and a button off to
 * the right made that a second place to aim at from a sofa. The one that is
 * already open is not a target at all — it would lead to the page it is drawn
 * on — so it takes no highlight and the pad walks past it.
 */
function VersionRow({
  romId,
  fsNameNoExt,
  detail,
  current,
  installed,
  onSelect
}: {
  romId: number
  fsNameNoExt: string
  /** The record behind this dump, absent until it arrives. */
  detail: RommRom | undefined
  current: boolean
  installed: boolean
  onSelect: () => void
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { ref, props } = useFocusable({
    onSelect,
    enabled: !current,
    actionLabel: t('action.open')
  })
  const regions = detail?.regions.join(', ')

  return (
    <li
      ref={ref as Ref<HTMLLIElement>}
      // Which game this row leads to, for `npm run test:app` — the same handle a
      // card in the library carries. See CONTRIBUTING.
      data-rom={romId}
      {...props}
    >
      <span className="asset__icon">
        <Icon name="roms" size={17} />
      </span>
      {/* Always, and beside the facts rather than instead of them: whether a
          dump is on this disk is what the list is read for, and leaving it off
          the row that happens to be open hides it from the one version whose
          answer is already known. */}
      {installed ? (
        <StatusBadge tone="ok" icon="confirm" label={t('library.downloadedMark')} />
      ) : null}
      {regions ? (
        <span className="chip chip--icon">
          <Icon name="region" size={14} />
          {regions}
        </span>
      ) : null}
      {detail?.revision ? (
        <span className="chip chip--icon">
          <Icon name="revision" size={14} />
          {/* Worded as the banner words it, so a revision reads the same on the
              page it names and in the list of the others. */}
          {t('game.revision', { revision: detail.revision })}
        </span>
      ) : null}
      {detail ? (
        <span className="chip chip--icon">
          <Icon name="size" size={14} />
          {formatBytes(detail.fs_size_bytes)}
        </span>
      ) : null}
      <span className="asset__name">{fsNameNoExt}</span>
      {/* At the end of the row, where a row's own state belongs: in front it
          stood among the chips describing the file and pushed them out of line
          with every other row. */}
      {current ? (
        <span className="asset__here">
          <StatusBadge tone="info" icon="details" label={t('versions.current')} />
        </span>
      ) : null}
    </li>
  )
}

import { type JSX, useState } from 'react'
import { GameCard, Hints, PageTitle, Spinner, tileFromRom } from '../../components'
import { usePagedRoms } from '../../paging'
import { useApp, useI18n } from '../../state'

/**
 * One collection, as a grid of what is on it.
 *
 * Deliberately the library's own grid rather than a shelf: a collection is a
 * list somebody curated and may be a hundred games long, and a row that scrolls
 * sideways is for a handful. Paging works the same way too — a sentinel below
 * the grid, so walking towards the bottom fetches the next page before the user
 * arrives at it.
 *
 * The name comes down in the route rather than being fetched again. It was on
 * screen a moment ago, in the list that was pressed to get here, and asking the
 * server for a word we already have would put a spinner where the title goes.
 */
export function CollectionScreen({
  collectionId,
  title
}: {
  /** A number for a collection the user made, a string for one RomM derived. */
  collectionId: number | string
  title: string
}): JSX.Element {
  const { t } = useI18n()
  const { installedIds, navigate } = useApp()

  const [error, setError] = useState<string | null>(null)
  const { roms, total, loading, sentinel } = usePagedRoms(
    // Two parameters for the two kinds, as RomM has it: the id's own type is
    // what says which of them this is.
    typeof collectionId === 'string'
      ? { virtual_collection_id: collectionId }
      : { collection_id: collectionId },
    { onError: setError }
  )

  return (
    <div className="content">
      <PageTitle icon="collection">{title}</PageTitle>
      <p className="page-subtitle">{t('library.count', { count: total ?? roms.length })}</p>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="grid">
        {roms.map((rom) => (
          <GameCard
            key={rom.id}
            tile={tileFromRom(rom)}
            installed={installedIds.has(rom.id)}
            onSelect={() => navigate({ name: 'game', romId: rom.id })}
            showPlatform
          />
        ))}
      </div>

      {/* Sits directly below the grid: crossing it is what pulls the next page. */}
      <div ref={sentinel} aria-hidden="true" />

      {loading ? <Spinner /> : null}

      {!loading && roms.length === 0 && !error ? (
        <div className="empty">{t('collections.emptyShelf')}</div>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: t('action.open') },
          { key: 'B', label: t('action.back') }
        ]}
      />
    </div>
  )
}

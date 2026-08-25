import { type JSX, type Ref, useEffect, useState } from 'react'
import type { RommCollection, RommCollectionBase, RommVirtualCollection } from '@shared/types'
import { CoverMosaic, Hints, Spinner } from '../../components'
import { Icon } from '../../icons'
import { useFocusable } from '../../input/focus'
import { useApp, useI18n } from '../../state'

/**
 * The shelves the user made on RomM, as shelves.
 *
 * A collection is the one grouping RomM has that RomMix cannot work out for
 * itself: platform comes off the ROM, recently-played comes off the play
 * history, but "the ones I am part way through" exists only because somebody
 * said so. So it is listed rather than derived, and it is the same list here as
 * in RomM's own web interface.
 */
export function CollectionsScreen(): JSX.Element {
  const { t } = useI18n()
  const { navigate } = useApp()
  const [own, setOwn] = useState<RommCollection[] | null>(null)
  const [derived, setDerived] = useState<RommVirtualCollection[]>([])
  const [error, setError] = useState<string | null>(null)
  /**
   * Which of the two lists are open.
   *
   * Never mixed into one grid: they are different kinds of thing. A collection
   * exists because somebody made it, and RomM derives one per genre, per
   * franchise, per company — which on a library of any size is dozens, and
   * interleaved they bury the handful this page is named after.
   *
   * So the user's own are open and RomM's are closed, which is also what makes
   * the closed row worth having: on a D-pad the only way past a tile is
   * through it, and forty derived shelves are forty presses between the top of
   * the page and the bottom of it.
   *
   * Not remembered between visits, like the grouping on Downloads. It is a way
   * of looking at the page rather than a preference about the library.
   */
  const [openMine, setOpenMine] = useState(true)
  const [openDerived, setOpenDerived] = useState(false)

  useEffect(() => {
    void window.rommix.library
      .collections()
      .then(setOwn)
      .catch((cause: Error) => setError(cause.message))
    // Its own request, so the shelves the user made still arrive if this one
    // does not. A server that cannot list these answers with none rather than
    // failing; anything else is reported centrally on `app:error`, and the page
    // goes on showing what it does have.
    void window.rommix.library
      .virtualCollections()
      .then(setDerived)
      .catch(() => setDerived([]))
  }, [])

  if (error) {
    return (
      <div className="content">
        <h1 className="page-title">{t('nav.collections')}</h1>
        <div className="notice notice--error">{error}</div>
      </div>
    )
  }

  if (!own) {
    return (
      <div className="content">
        <h1 className="page-title">{t('nav.collections')}</h1>
        <Spinner />
      </div>
    )
  }

  // An empty one is a shelf with nothing on it: RomM keeps it, and opening it
  // would be a page saying so. Left out here rather than explained there.
  const stocked = <T extends RommCollectionBase>(list: T[]): T[] =>
    list.filter((collection) => collection.rom_count > 0)
  const mine = stocked(own)
  const theirs = stocked(derived)

  const open = (collection: RommCollection | RommVirtualCollection): void =>
    navigate({ name: 'collection', collectionId: collection.id, title: collection.name })

  return (
    <div className="content">
      <h1 className="page-title">{t('nav.collections')}</h1>
      <p className="page-subtitle">{t('collections.subtitle')}</p>

      {mine.length === 0 && theirs.length === 0 ? (
        <div className="empty">{t('collections.empty')}</div>
      ) : null}

      {/* A section only where it has something in it: a closed row promising
          nothing is a press that opens an empty grid. */}
      {mine.length > 0 ? (
        <CollectionGroup
          title={t('collections.mine')}
          collections={mine}
          open={openMine}
          onToggle={() => setOpenMine((current) => !current)}
          onOpen={open}
        />
      ) : null}

      {theirs.length > 0 ? (
        <CollectionGroup
          title={t('collections.derived')}
          collections={theirs}
          open={openDerived}
          onToggle={() => setOpenDerived((current) => !current)}
          onOpen={open}
        />
      ) : null}

      <Hints
        items={[
          { key: 'A', label: t('collections.openExpand') },
          { key: 'B', label: t('action.back') }
        ]}
      />
    </div>
  )
}

/**
 * One of the two lists, collapsed to a single row until asked.
 *
 * The same header the Downloads page groups by platform with, for the same
 * reason: closed, it says how many are behind it, which is the whole of what
 * somebody needs to decide whether to open it.
 *
 * The tiles are not rendered while it is closed. Forty derived shelves are
 * forty covers to fetch and forty focusables to walk past, and a lid over them
 * that still paid for all of it would be a lid in name only.
 */
function CollectionGroup({
  title,
  collections,
  open,
  onToggle,
  onOpen
}: {
  title: string
  collections: (RommCollection | RommVirtualCollection)[]
  open: boolean
  onToggle: () => void
  onOpen: (collection: RommCollection | RommVirtualCollection) => void
}): JSX.Element {
  const { t } = useI18n()
  const { ref, props } = useFocusable({
    onSelect: onToggle,
    actionLabel: open ? t('action.collapse') : t('action.expand')
  })

  return (
    <section className="group">
      <div ref={ref as Ref<HTMLDivElement>} className="group__header" data-open={open} {...props}>
        <span className="group__chevron">
          <Icon name={open ? 'collapse' : 'expand'} size={16} />
        </span>
        <span className="group__name">{title}</span>
        <span className="group__meta">{t('collections.count', { count: collections.length })}</span>
      </div>

      {open ? (
        <div className="grid">
          {collections.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              onSelect={() => onOpen(collection)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

/**
 * One shelf, drawn from what is on it.
 *
 * Artwork uploaded for the collection itself wins outright — that is a picture
 * somebody chose for this shelf, which no mosaic of its contents can better.
 * Failing that, RomM sends the covers of the first few games on it for exactly
 * this purpose, so the tile costs no request of its own.
 */
function CollectionCard({
  collection,
  onSelect
}: {
  collection: RommCollection | RommVirtualCollection
  onSelect: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { ref, props } = useFocusable({ onSelect, actionLabel: t('action.open') })
  const chosen = collection.path_cover_small ?? collection.path_cover_large
  const covers = chosen ? [chosen] : collection.path_covers_small

  return (
    <button ref={ref as Ref<HTMLButtonElement>} className="card" {...props}>
      <CoverMosaic paths={covers} name={collection.name} />
      <div className="card__title">{collection.name}</div>
      <div className="card__meta">
        <span>{t('library.count', { count: collection.rom_count })}</span>
      </div>
    </button>
  )
}

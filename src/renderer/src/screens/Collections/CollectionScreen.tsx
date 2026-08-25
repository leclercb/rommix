import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { RommRom } from '@shared/types'
import { GameCard, Hints, Spinner, tileFromRom } from '../../components'
import { useApp, useI18n } from '../../state'

/** How many covers a page of a collection is. Matches the library's grid. */
const PAGE_SIZE = 60

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

  const [roms, setRoms] = useState<RommRom[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Synchronous guard: `loading` lands a render too late to stop the observer
  // firing several times while one request is still out.
  const inFlight = useRef(false)

  const load = useCallback(
    async (offset: number): Promise<void> => {
      if (inFlight.current) return
      inFlight.current = true
      setLoading(true)
      try {
        const page = await window.rommix.library.roms({
          // Two parameters for the two kinds, as RomM has it: the id's own type
          // is what says which of them this is.
          ...(typeof collectionId === 'string'
            ? { virtual_collection_id: collectionId }
            : { collection_id: collectionId }),
          limit: PAGE_SIZE,
          offset
        })
        setTotal(page.total)
        setRoms((current) => (offset === 0 ? page.items : [...current, ...page.items]))
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        inFlight.current = false
        setLoading(false)
      }
    },
    [collectionId]
  )

  useEffect(() => {
    void load(0)
  }, [load])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    if (roms.length === 0 || roms.length >= total) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(roms.length)
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [load, roms.length, total])

  return (
    <div className="content">
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">{t('library.count', { count: total })}</p>

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
      <div ref={sentinelRef} aria-hidden="true" />

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

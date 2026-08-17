import { type JSX, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { RommPlatform, RommRom } from '@shared/types'
import { FocusButton, GameCard, Hints, Spinner, TextField } from '../components'
import { useAction, useFocusable } from '../input/focus'
import { useApp } from '../state'

const PAGE_SIZE = 60

/**
 * The full library browser: search, filter by platform, and a paginated grid.
 *
 * Paging is explicit ("Load more") rather than infinite scroll — with a
 * controller you cannot flick a scrollbar, and a focusable button at the end of
 * the grid is something the spatial navigator can actually reach.
 */
export function LibraryScreen({ platformId }: { platformId?: number }): JSX.Element {
  const { installedIds, navigate } = useApp()

  const [platforms, setPlatforms] = useState<RommPlatform[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<number | undefined>(platformId)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roms, setRoms] = useState<RommRom[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void window.rommix.library
      .platforms()
      .then((list) => setPlatforms(list.filter((p) => p.rom_count > 0)))
      .catch((cause: Error) => setError(cause.message))
  }, [])

  // Debounce so typing a title does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 350)
    return () => window.clearTimeout(timer)
  }, [search])

  const load = useCallback(
    async (offset: number): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const page = await window.rommix.library.roms({
          search_term: debouncedSearch || undefined,
          platform_ids: selectedPlatform ? [selectedPlatform] : undefined,
          limit: PAGE_SIZE,
          offset
        })
        setTotal(page.total)
        setRoms((current) => (offset === 0 ? page.items : [...current, ...page.items]))
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [debouncedSearch, selectedPlatform]
  )

  // Reset to the first page whenever the query changes.
  useEffect(() => {
    void load(0)
  }, [load])

  // Y jumps to the search box, as the hint bar advertises.
  useAction('search', () => {
    const input = searchRef.current?.querySelector('input')
    input?.focus()
  })

  const platformName = useMemo(
    () => platforms.find((p) => p.id === selectedPlatform)?.display_name,
    [platforms, selectedPlatform]
  )

  return (
    <div className="content">
      <h1 className="page-title">Library</h1>
      <p className="page-subtitle">
        {total > 0
          ? `${total.toLocaleString()} game${total === 1 ? '' : 's'}${platformName ? ` on ${platformName}` : ''}`
          : 'Browse everything on your RomM server'}
      </p>

      <div ref={searchRef} className="form">
        <TextField
          label="Search"
          value={search}
          onChange={setSearch}
          placeholder="Game title…"
          hint="Press Y to jump here, Escape to leave the field."
        />
      </div>

      <div className="segmented">
        <PlatformChip
          label="All platforms"
          active={selectedPlatform === undefined}
          onSelect={() => setSelectedPlatform(undefined)}
        />
        {platforms.map((platform) => (
          <PlatformChip
            key={platform.id}
            label={`${platform.display_name} (${platform.rom_count})`}
            active={platform.id === selectedPlatform}
            onSelect={() => setSelectedPlatform(platform.id)}
          />
        ))}
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="grid">
        {roms.map((rom) => (
          <GameCard
            key={rom.id}
            rom={rom}
            installed={installedIds.has(rom.id)}
            onSelect={() => navigate({ name: 'detail', romId: rom.id })}
            showPlatform={selectedPlatform === undefined}
          />
        ))}
      </div>

      {loading ? <Spinner /> : null}

      {!loading && roms.length === 0 && !error ? (
        <div className="empty">No games match that search.</div>
      ) : null}

      {!loading && roms.length < total ? (
        <div className="btn-row">
          <FocusButton onSelect={() => void load(roms.length)}>
            Load more ({total - roms.length} remaining)
          </FocusButton>
        </div>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: 'Open' },
          { key: 'Y', label: 'Search' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}

function PlatformChip({
  label,
  active,
  onSelect
}: {
  label: string
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className="segmented__option"
      data-active={active}
      {...props}
    >
      {label}
    </button>
  )
}

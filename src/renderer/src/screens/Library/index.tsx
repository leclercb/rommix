import { type JSX, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { RommPlatform, RommRom } from '@shared/types'
import { GameCard, Hints, PlatformIcon, Spinner, TextField, tileFromRom } from '../../components'
import { useAction, useFocusable, useKeyLabel } from '../../input/focus'
import { useApp, useI18n } from '../../state'

const PAGE_SIZE = 60

/**
 * The full library browser: search, filter by platform, and an endless grid.
 *
 * Paging is driven by a sentinel below the grid rather than a "Load more"
 * button. That works on a controller as well as a mouse because moving focus
 * calls scrollIntoView, so navigating towards the bottom row scrolls the
 * sentinel into view and fetches the next page before the user arrives —
 * there is nothing to aim at and press.
 */
export function LibraryScreen(): JSX.Element {
  const { t } = useI18n()
  const { installedIds, navigate } = useApp()
  const keyLabel = useKeyLabel()

  const [platforms, setPlatforms] = useState<RommPlatform[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<number | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roms, setRoms] = useState<RommRom[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Synchronous guard: `loading` state lands a render too late to stop the
  // observer firing several times while one request is still in flight.
  const inFlight = useRef(false)

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
      if (inFlight.current) return
      inFlight.current = true
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
        inFlight.current = false
        setLoading(false)
      }
    },
    [debouncedSearch, selectedPlatform]
  )

  // Reset to the first page whenever the query changes.
  useEffect(() => {
    void load(0)
  }, [load])

  /**
   * Fetch the next page as the end of the grid comes into view.
   *
   * The margin is deliberately generous: a page is 60 covers, and starting the
   * request a screenful early means the next rows are usually there by the time
   * focus reaches them, so the grid never visibly stalls.
   */
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
      <h1 className="page-title">{t('library.title')}</h1>
      <p className="page-subtitle">
        {total === 0
          ? t('library.browseAll')
          : platformName
            ? t('library.countOnPlatform', { count: total, platform: platformName })
            : t('library.count', { count: total })}
      </p>

      <div ref={searchRef} className="form">
        <TextField
          label={t('action.search')}
          value={search}
          onChange={setSearch}
          placeholder={t('library.searchPlaceholder')}
          hint={t('library.searchHint', { key: keyLabel('Y') })}
        />
      </div>

      <div className="segmented">
        <PlatformChip
          label={t('library.allPlatforms')}
          active={selectedPlatform === undefined}
          onSelect={() => setSelectedPlatform(undefined)}
        />
        {platforms.map((platform) => (
          <PlatformChip
            key={platform.id}
            label={t('library.platformChip', {
              name: platform.display_name,
              count: platform.rom_count
            })}
            icon={<PlatformIcon slug={platform.slug} size={20} label={platform.display_name} />}
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
            tile={tileFromRom(rom)}
            installed={installedIds.has(rom.id)}
            onSelect={() => navigate({ name: 'game', romId: rom.id })}
            showPlatform={selectedPlatform === undefined}
          />
        ))}
      </div>

      {/* Sits directly below the grid: crossing it is what pulls the next page. */}
      <div ref={sentinelRef} aria-hidden="true" />

      {loading ? <Spinner /> : null}

      {!loading && roms.length === 0 && !error ? (
        <div className="empty">{t('library.noMatches')}</div>
      ) : null}

      {!loading && roms.length > 0 && roms.length >= total ? (
        <div className="empty" style={{ padding: '28px 0' }}>
          {t('library.thatIsAll', { count: total })}
        </div>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: t('action.open') },
          { key: 'Y', label: t('action.search') },
          { key: 'B', label: t('action.back') }
        ]}
      />
    </div>
  )
}

function PlatformChip({
  label,
  icon,
  active,
  onSelect
}: {
  label: string
  icon?: JSX.Element
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className="segmented__option segmented__option--icon"
      data-active={active}
      {...props}
    >
      {icon}
      {label}
    </button>
  )
}

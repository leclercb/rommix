import { type JSX, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { resolveSystem } from '@config/systems'
import type { InstalledRom, RommPlatform, RommRom } from '@shared/types'
import {
  GameCard,
  Hints,
  PlatformIcon,
  SegmentedControl,
  Spinner,
  TextField,
  tileFromInstalled,
  tileFromRom
} from '../../components'
import { useAction, useFocusable, useKeyLabel } from '../../input/focus'
import { useApp, useI18n } from '../../state'
import { fileNameOf } from '@shared/gamefiles'

const PAGE_SIZE = 60

/**
 * Which games the grid is drawn from.
 *
 * `downloaded` is not the same query with a flag on it: what is on this device
 * is local knowledge the server does not have, so it cannot be asked for in a
 * page of results. Filtering the server's pages by it instead would leave the
 * grid showing the handful of downloaded games that happened to fall in the
 * first sixty, and the endless scroll fetching page after page to find more.
 * So that scope is answered from the installed index, which is complete, small
 * and already in hand.
 */
type Scope = 'all' | 'downloaded'

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
  const { installed, installedIds, navigate, settings } = useApp()
  const keyLabel = useKeyLabel()

  const [scope, setScope] = useState<Scope>('all')
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
      // Nothing to fetch for the downloaded scope, and the effect below runs
      // again with a fresh page when the grid goes back to the server.
      if (scope === 'downloaded' || inFlight.current) return
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
    [debouncedSearch, selectedPlatform, scope]
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
    if (!sentinel || scope === 'downloaded') return
    if (roms.length === 0 || roms.length >= total) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(roms.length)
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [load, roms.length, total, scope])

  // Y jumps to the search box, as the hint bar advertises.
  useAction('search', () => {
    const input = searchRef.current?.querySelector('input')
    input?.focus()
  })

  const chosen = useMemo(
    () => platforms.find((p) => p.id === selectedPlatform),
    [platforms, selectedPlatform]
  )
  const platformName = chosen?.display_name

  /**
   * The downloaded games, narrowed by whatever the two filters above say.
   *
   * Matched on the ES-DE system rather than the platform: the index records
   * which folder a game was installed into, not the RomM platform it came
   * from, and `resolveSystem` is the same rule that decided that folder.
   */
  const downloaded = useMemo(() => {
    if (scope !== 'downloaded') return []
    const system = chosen
      ? resolveSystem(chosen.slug, chosen.fs_slug, settings?.systemOverrides)
      : null
    // A platform RomMix cannot place has no folder to have downloaded into, so
    // the honest answer for it is none rather than every game on the device.
    if (chosen && !system) return []
    const term = search.trim().toLowerCase()
    const titleOf = (entry: InstalledRom): string => entry.name || fileNameOf(entry.path)
    return installed
      .filter((entry) => (system ? entry.system === system : true))
      .filter((entry) => (term ? titleOf(entry).toLowerCase().includes(term) : true))
      .sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
  }, [scope, installed, chosen, search, settings?.systemOverrides])

  const tiles = useMemo(
    () => (scope === 'downloaded' ? downloaded.map(tileFromInstalled) : roms.map(tileFromRom)),
    [scope, downloaded, roms]
  )
  const count = scope === 'downloaded' ? tiles.length : total
  // Only the server scope has anything to wait for.
  const busy = loading && scope === 'all'

  return (
    <div className="content">
      <h1 className="page-title">{t('library.title')}</h1>
      <p className="page-subtitle">
        {count === 0
          ? t('library.browseAll')
          : platformName
            ? t('library.countOnPlatform', { count, platform: platformName })
            : t('library.count', { count })}
      </p>

      {/* One block, in the order the questions narrow: which library, then a
          title, then which platform of it. */}
      <div className="filters">
        <div className="filter">
          <span className="filter__label">{t('library.scopeLabel')}</span>
          <SegmentedControl<Scope>
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: t('library.scopeAll') },
              { value: 'downloaded', label: t('library.scopeDownloaded') }
            ]}
          />
        </div>

        <div ref={searchRef}>
          <TextField
            label={t('library.searchLabel')}
            value={search}
            onChange={setSearch}
            placeholder={t('library.searchPlaceholder')}
            hint={t('library.searchHint', { key: keyLabel('Y') })}
          />
        </div>

        <div className="filter">
          <span className="filter__label">{t('library.platformLabel')}</span>
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
        </div>
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="grid">
        {tiles.map((tile) => (
          <GameCard
            key={tile.romId}
            tile={tile}
            installed={installedIds.has(tile.romId)}
            onSelect={() => navigate({ name: 'game', romId: tile.romId })}
            showPlatform={selectedPlatform === undefined}
          />
        ))}
      </div>

      {/* Sits directly below the grid: crossing it is what pulls the next page. */}
      <div ref={sentinelRef} aria-hidden="true" />

      {busy ? <Spinner /> : null}

      {/* A scope with nothing in it at all is not a search that found nothing,
          and on a fresh install the downloaded grid is the empty one. */}
      {!busy && tiles.length === 0 && !error ? (
        <div className="empty">
          {scope === 'downloaded' && !search && selectedPlatform === undefined
            ? t('library.noneDownloaded')
            : t('library.noMatches')}
        </div>
      ) : null}

      {!busy && scope === 'all' && roms.length > 0 && roms.length >= total ? (
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

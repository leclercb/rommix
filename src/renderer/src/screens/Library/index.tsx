import { type JSX, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { resolveSystem } from '@config/systems'
import { hasMorePages } from '@shared/types'
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
  const { installed, installedIds, navigate, offline, settings } = useApp()
  const keyLabel = useKeyLabel()

  /**
   * Away from the server there is one scope, and it is not a choice.
   *
   * The downloaded scope is already answered from the installed index rather
   * than from a query — see `Scope` — so the screen keeps its search, its
   * platform filter and its grid, and loses only the half that was never here.
   * Held as the user's own choice underneath, so coming back into range puts
   * the whole library back rather than leaving them on a filter they never set.
   */
  const [chosenScope, setScope] = useState<Scope>('all')
  const scope: Scope = offline ? 'downloaded' : chosenScope
  const [platforms, setPlatforms] = useState<RommPlatform[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<number | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roms, setRoms] = useState<RommRom[]>([])
  const [total, setTotal] = useState<number | null>(0)
  /** Whether the last page came back full. See `hasMorePages`. */
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Synchronous guard: `loading` state lands a render too late to stop the
  // observer firing several times while one request is still in flight.
  const inFlight = useRef(false)
  /**
   * Which fetch the grid is listening to. See the same guard in `useShelf`.
   *
   * A page already on the wire when the server goes away lands after the grid
   * has narrowed to what is downloaded, and its rejection would put an error
   * over a screen that is working perfectly well without it.
   */
  const run = useRef(0)

  /**
   * The platforms, which the server's last list stands in for while it is away.
   * See `library:platforms`.
   *
   * Asked again when the connection changes, and not before it is known. A
   * device that starts out of range with nothing saved has no filter to draw
   * and an error to explain why; without this it would keep both after RomM
   * came back, since the only other thing that clears the error is a fetch the
   * downloaded scope never makes.
   */
  useEffect(() => {
    if (offline === null) return
    void window.rommix.library
      .platforms()
      .then((list) => {
        setPlatforms(list.filter((p) => p.rom_count > 0))
        setError(null)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [offline])

  // Debounce so typing a title does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 350)
    return () => window.clearTimeout(timer)
  }, [search])

  const load = useCallback(
    async (offset: number): Promise<void> => {
      // Nothing to fetch for the downloaded scope, and the effect below runs
      // again with a fresh page when the grid goes back to the server.
      //
      // Nor before the first connection answer: the grid is about to narrow to
      // what is downloaded, and a request sent in the meantime comes back as a
      // fetch error over a screen that has nothing to fetch. The spinner it
      // already shows is the honest state until then.
      if (offline !== false || scope === 'downloaded' || inFlight.current) {
        // Whatever is still out belongs to a grid that has stopped listening.
        if (offline === true) run.current += 1
        return
      }
      inFlight.current = true
      const mine = ++run.current
      setLoading(true)
      setError(null)
      try {
        const page = await window.rommix.library.roms({
          search_term: debouncedSearch || undefined,
          platform_ids: selectedPlatform ? [selectedPlatform] : undefined,
          limit: PAGE_SIZE,
          offset
        })
        if (mine !== run.current) return
        setTotal(page.total)
        setMore(hasMorePages(page))
        setRoms((current) => (offset === 0 ? page.items : [...current, ...page.items]))
      } catch (cause) {
        if (mine === run.current) setError((cause as Error).message)
      } finally {
        inFlight.current = false
        if (mine === run.current) setLoading(false)
      }
    },
    [debouncedSearch, selectedPlatform, scope, offline]
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
    if (roms.length === 0 || !more) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(roms.length)
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [load, roms.length, more, scope])

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
  // What the server counted, or what is actually here when it counted
  // nothing — which is the whole of it once there are no more pages.
  const count = scope === 'downloaded' ? tiles.length : (total ?? roms.length)
  // Only the server scope has anything to wait for — and until the connection
  // has answered, every scope does: which one this screen is showing is not
  // settled yet.
  const busy = (loading && scope === 'all') || offline === null

  return (
    <div className="content">
      <h1 className="page-title">{t('library.title')}</h1>
      <p className="page-subtitle">
        {count === 0
          ? // "Browse everything on your server" is not what this screen is
            // while the server is away, and the grid below says the rest.
            t(offline ? 'library.noneDownloaded' : 'library.browseAll')
          : platformName
            ? t('library.countOnPlatform', { count, platform: platformName })
            : t('library.count', { count })}
      </p>

      {/* One block, in the order the questions narrow: which library, then a
          title, then which platform of it. */}
      {/* Above the filters, because it explains what they are filtering: with
          the server away this screen is the downloaded games and the scope
          control has gone with it. */}
      {offline ? <div className="notice notice--warn">{t('app.offlineNotice')}</div> : null}

      <div className="filters">
        {offline ? null : (
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
        )}

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

      {!busy && scope === 'all' && roms.length > 0 && !more ? (
        <div className="empty" style={{ padding: '28px 0' }}>
          {t('library.thatIsAll', { count })}
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

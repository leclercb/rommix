import { type JSX, useCallback, useEffect, useMemo, useState, type Ref } from 'react'
import { resolveSystem } from '@config/systems'
import type { InstalledRom, RommPlatform } from '@shared/types'
import {
  GameCard,
  Hints,
  PageTitle,
  PlatformIcon,
  SegmentedControl,
  Spinner,
  TextField,
  romToOpen,
  tileFromInstalled,
  tileFromRom,
  tileInstalled
} from '../../components'
import { useAction, useFocusable, useFocusContext, useKeyLabel } from '../../input/focus'
import { usePagedRoms } from '../../paging'
import { useApp, useI18n } from '../../state'
import { fileNameOf } from '@shared/gamefiles'

/** The search box's name in the focus registry, for the shortcut that jumps to it. */
const SEARCH_FIELD = 'library-search'

/** What a downloaded game is listed, sorted and searched under. */
const titleOf = (entry: InstalledRom): string => entry.name || fileNameOf(entry.path)

/**
 * Which games the grid is drawn from.
 *
 * `downloaded` is not the same query with a flag on it: what is on this device
 * is local knowledge the server does not have, so it cannot be asked for in a
 * page of results. Filtering the server's pages by it instead would leave the
 * grid showing the handful of downloaded games that happened to fall in the
 * first page, and the endless scroll fetching page after page to find more.
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
  /**
   * What the search term leaves on each platform, as the server counted it.
   *
   * Null until there is a term to count, and a platform is absent from it
   * while its count is on the wire — see `countFor`, which is where a chip
   * with no number to show decides what to draw instead.
   */
  const [searchCounts, setSearchCounts] = useState<Record<number, number> | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState<number | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  /**
   * The server's half of the grid.
   *
   * Nothing is asked for while the grid is showing what is downloaded, which
   * is answered from the installed index — see `Scope`. Nor before the first
   * connection answer: the grid is about to narrow to this device, and a
   * request sent in the meantime comes back as a fetch error over a screen
   * that has nothing to fetch. The spinner it already shows is the honest
   * state until then.
   */
  const { roms, total, more, loading, sentinel } = usePagedRoms(
    {
      search_term: debouncedSearch || undefined,
      platform_ids: selectedPlatform ? [selectedPlatform] : undefined,
      // One tile per game rather than one per dump. A library with the USA, the
      // European and the revised copy of everything is three grids of the same
      // games, and the count under the title is a number nobody recognises as
      // their collection. Which versions there are is on the game's own page.
      group_by_meta_id: true
    },
    { enabled: offline === false && scope === 'all', onError: setError }
  )

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

  /**
   * Count the search term against each platform on offer.
   *
   * `rom_count` is the platform entire, so a search left every chip promising
   * games the grid it opens does not hold. Only the server can say otherwise —
   * see `romCounts` — and it is asked for the debounced term, alongside the
   * grid's own request rather than once per keystroke.
   */
  useEffect(() => {
    if (offline !== false || scope !== 'all' || !debouncedSearch || platforms.length === 0) {
      setSearchCounts(null)
      return
    }
    let listening = true
    void window.rommix.library
      .platformCounts(
        platforms.map((platform) => platform.id),
        debouncedSearch
      )
      .then((counts) => {
        if (listening) setSearchCounts(counts)
      })
      // Nothing worth saying that the grid's own failure does not already say.
      .catch(() => {
        if (listening) setSearchCounts(null)
      })
    return () => {
      listening = false
    }
  }, [offline, scope, debouncedSearch, platforms])

  /**
   * Y jumps to the search box, as the hint bar advertises.
   *
   * Both halves, in the order pressing A on the field does them. The ring is
   * drawn from `[data-focused]` and nothing else, so reaching past the registry
   * to call `.focus()` on the box put the letters in it and left the highlight
   * on whatever was focused before — and the two ways into one field must not
   * disagree. `setFocus` moves the highlight; `activate` runs the field's own
   * `onSelect`, which is what takes the caret.
   */
  const { setFocus, activate } = useFocusContext()
  useAction('search', () => {
    setFocus(SEARCH_FIELD)
    activate()
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
    return installed
      .filter((entry) => (system ? entry.system === system : true))
      .filter((entry) => (term ? titleOf(entry).toLowerCase().includes(term) : true))
      .sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
  }, [scope, installed, chosen, search, settings?.systemOverrides])

  /**
   * How many downloaded games each ES-DE system holds under the search term.
   * Keyed by system for the reason `downloaded` matches on one.
   */
  const downloadedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (scope !== 'downloaded') return counts
    const term = search.trim().toLowerCase()
    for (const entry of installed) {
      if (term && !titleOf(entry).toLowerCase().includes(term)) continue
      counts.set(entry.system, (counts.get(entry.system) ?? 0) + 1)
    }
    return counts
  }, [scope, installed, search])

  /**
   * The number on a platform's chip: how many games pressing it would draw.
   *
   * Undefined where the filters in force have no count to give yet, which is a
   * chip drawn without one rather than a chip claiming a number it no longer
   * stands for.
   */
  const countFor = useCallback(
    (platform: RommPlatform): number | undefined => {
      if (scope === 'downloaded') {
        const system = resolveSystem(platform.slug, platform.fs_slug, settings?.systemOverrides)
        // A platform RomMix cannot place has no folder to have downloaded
        // into — the same answer `downloaded` gives for it.
        return system ? (downloadedCounts.get(system) ?? 0) : 0
      }
      if (!debouncedSearch) return platform.rom_count
      return searchCounts?.[platform.id]
    },
    [scope, downloadedCounts, settings?.systemOverrides, debouncedSearch, searchCounts]
  )

  const tiles = useMemo(
    () =>
      scope === 'downloaded'
        ? downloaded.map(tileFromInstalled)
        : roms.map((rom) => tileFromRom(rom, true)),
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
      <PageTitle icon="library">{t('library.title')}</PageTitle>
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

        <div>
          <TextField
            focusId={SEARCH_FIELD}
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
              id="all"
              label={t('library.allPlatforms')}
              active={selectedPlatform === undefined}
              onSelect={() => setSelectedPlatform(undefined)}
            />
            {platforms.map((platform) => {
              const matching = countFor(platform)
              // A platform the other filters have emptied is not a filter worth
              // offering — the rule the list itself is built with. The chosen
              // one stays whatever it holds, or there is no way back out of it.
              if (matching === 0 && platform.id !== selectedPlatform) return null
              return (
                <PlatformChip
                  key={platform.id}
                  id={String(platform.id)}
                  label={
                    matching === undefined
                      ? platform.display_name
                      : t('library.platformChip', {
                          name: platform.display_name,
                          count: matching
                        })
                  }
                  icon={
                    <PlatformIcon slug={platform.slug} size={20} label={platform.display_name} />
                  }
                  active={platform.id === selectedPlatform}
                  onSelect={() => setSelectedPlatform(platform.id)}
                />
              )
            })}
          </div>
        </div>
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="grid">
        {tiles.map((tile) => (
          <GameCard
            key={tile.romId}
            tile={tile}
            installed={tileInstalled(tile, installedIds)}
            onSelect={() => navigate({ name: 'game', romId: romToOpen(tile, installedIds) })}
            showPlatform={selectedPlatform === undefined}
          />
        ))}
      </div>

      {/* Sits directly below the grid: crossing it is what pulls the next page. */}
      <div ref={sentinel} aria-hidden="true" />

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
  id,
  label,
  icon,
  active,
  onSelect
}: {
  id: string
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
      data-platform={id}
      data-active={active}
      {...props}
    >
      {icon}
      {label}
    </button>
  )
}

import { type JSX, useEffect, useState } from 'react'
import type { RommRom } from '@shared/types'
import { CoverArt, GameRow, Hints, Spinner } from '../components'
import { useApp } from '../state'

/**
 * The landing screen: a hero for the highlighted game and a few shelves,
 * mirroring how RomM's own home page groups a library.
 */

interface Shelves {
  continuePlaying: RommRom[]
  favourites: RommRom[]
  recentlyAdded: RommRom[]
}

export function HomeScreen(): JSX.Element {
  const { installedIds, navigate, installed } = useApp()
  const [shelves, setShelves] = useState<Shelves | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<RommRom | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [played, favourites, recent] = await Promise.all([
          window.rommix.library.roms({ last_played: true, limit: 20, order_by: 'last_played', order_dir: 'desc' }),
          window.rommix.library.roms({ favorite: true, limit: 20 }),
          window.rommix.library.roms({ limit: 20, order_by: 'created_at', order_dir: 'desc' })
        ])
        setShelves({
          continuePlaying: played.items,
          favourites: favourites.items,
          recentlyAdded: recent.items
        })
        setHighlight(played.items[0] ?? recent.items[0] ?? null)
      } catch (cause) {
        setError((cause as Error).message)
      }
    })()
  }, [])

  if (error) {
    return (
      <div className="content">
        <h1 className="page-title">Home</h1>
        <div className="notice notice--error">{error}</div>
      </div>
    )
  }

  if (!shelves) {
    return (
      <div className="content">
        <Spinner />
      </div>
    )
  }

  // Games already on disk, resolved from the shelves we have loaded.
  const onDisk = [...shelves.continuePlaying, ...shelves.favourites, ...shelves.recentlyAdded]
    .filter((rom, index, all) => all.findIndex((r) => r.id === rom.id) === index)
    .filter((rom) => installedIds.has(rom.id))

  const open = (rom: RommRom): void => navigate({ name: 'detail', romId: rom.id })

  return (
    <div className="content">
      {highlight ? <Hero rom={highlight} /> : null}

      <GameRow
        title="Continue playing"
        roms={shelves.continuePlaying}
        installedIds={installedIds}
        onSelect={open}
      />
      <GameRow
        title="Ready to play"
        roms={onDisk}
        installedIds={installedIds}
        onSelect={open}
      />
      <GameRow
        title="Favourites"
        roms={shelves.favourites}
        installedIds={installedIds}
        onSelect={open}
      />
      <GameRow
        title="Recently added"
        roms={shelves.recentlyAdded}
        installedIds={installedIds}
        onSelect={open}
      />

      {shelves.continuePlaying.length === 0 &&
      shelves.recentlyAdded.length === 0 &&
      shelves.favourites.length === 0 ? (
        <div className="empty">
          Your RomM library looks empty. Add some ROMs on the server and run a scan.
        </div>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: 'Open' },
          { key: 'Y', label: 'Search' },
          { key: 'B', label: 'Back' }
        ]}
      />
      <div className="faint" style={{ marginTop: 24, fontSize: 14 }}>
        {installed.length} game{installed.length === 1 ? '' : 's'} downloaded locally
      </div>
    </div>
  )
}

function Hero({ rom }: { rom: RommRom }): JSX.Element {
  const title = rom.name ?? rom.fs_name
  const year = rom.metadatum.first_release_date
    ? new Date(rom.metadatum.first_release_date * 1000).getFullYear()
    : null

  return (
    <div className="hero">
      <div className="hero__art">
        <CoverArt path={rom.path_cover_large ?? rom.path_cover_small} name={title} />
      </div>
      <div>
        <h1 className="hero__title">{title}</h1>
        <div className="hero__meta">
          <span className="chip">{rom.platform_display_name}</span>
          {year ? <span className="chip">{year}</span> : null}
          {rom.metadatum.genres.slice(0, 3).map((genre) => (
            <span className="chip" key={genre}>
              {genre}
            </span>
          ))}
        </div>
        {rom.summary ? <p className="hero__summary">{rom.summary}</p> : null}
      </div>
    </div>
  )
}

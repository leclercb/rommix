import type { RomMixBridge } from '@shared/api'
import type {
  BiosPlatform,
  DownloadItem,
  InstalledRom,
  RommPlatform,
  RommRom,
  RomQuery,
  SaveAsset,
  Settings
} from '@shared/types'

/**
 * A `window.rommix` for the browser — `npm run preview:web` only.
 *
 * There is no preload script outside Electron, so the front end would fail on
 * its first call. This answers every one of them from a small library held in
 * memory, which is enough to look at every screen: shelves, a grid, a game with
 * artwork and saves, a queue with a transfer running in it.
 *
 * It is a mannequin, not a simulator. Nothing is persisted, nothing reaches a
 * RomM server, and the actions that would touch a disk or an emulator report
 * plausible success without doing anything. Judge layout and navigation here;
 * judge behaviour in the real app.
 *
 * The module is imported only under the `VITE_WEB_PREVIEW` flag that
 * `vite.web.config.ts` sets, so it is never part of a shipped bundle.
 */

// ---------------------------------------------------------------------------
// Placeholder artwork
// ---------------------------------------------------------------------------

/** A stable hue per asset, so a game keeps its colours across a reload. */
function hueOf(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return hash
}

/**
 * Stand-in art as a data URI.
 *
 * Two bands of colour and a couple of shapes rather than a flat rectangle: the
 * banner on the detail screen blurs whatever it is given, and a flat fill blurs
 * into nothing at all — which would make a broken backdrop and a working one
 * look identical.
 */
function placeholderArt(seed: string, label: string): string {
  const hue = hueOf(seed)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 55% 42%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 48) % 360} 60% 16%)"/>
    </linearGradient></defs>
    <rect width="300" height="400" fill="url(#g)"/>
    <circle cx="232" cy="86" r="74" fill="hsl(${(hue + 190) % 360} 70% 62%)" opacity="0.5"/>
    <rect x="-20" y="250" width="340" height="60" fill="hsl(${hue} 80% 70%)" opacity="0.25"/>
    <text x="150" y="215" fill="#fff" opacity="0.92" font-family="sans-serif"
      font-size="26" font-weight="700" text-anchor="middle">${label}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const PLATFORMS: RommPlatform[] = [
  {
    id: 1,
    slug: 'snes',
    fs_slug: 'snes',
    name: 'Super Nintendo Entertainment System',
    display_name: 'Super Nintendo',
    custom_name: null,
    rom_count: 3,
    fs_size_bytes: 12_500_000,
    url_logo: null,
    missing_from_fs: false
  },
  {
    id: 2,
    slug: 'ps',
    fs_slug: 'psx',
    name: 'Sony PlayStation',
    display_name: 'PlayStation',
    custom_name: null,
    rom_count: 2,
    fs_size_bytes: 1_400_000_000,
    url_logo: null,
    missing_from_fs: false
  },
  {
    id: 3,
    slug: 'switch',
    fs_slug: 'switch',
    name: 'Nintendo Switch',
    display_name: 'Nintendo Switch',
    custom_name: null,
    rom_count: 1,
    fs_size_bytes: 14_000_000_000,
    url_logo: null,
    missing_from_fs: false
  }
]

/** Everything a `RommRom` needs, so a sample only states what makes it itself. */
function game(seed: Partial<RommRom> & Pick<RommRom, 'id' | 'name' | 'platform_id'>): RommRom {
  const platform = PLATFORMS.find((item) => item.id === seed.platform_id) ?? PLATFORMS[0]
  const stem = (seed.name ?? 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return {
    slug: stem,
    summary: null,
    platform_slug: platform.slug,
    platform_fs_slug: platform.fs_slug,
    platform_display_name: platform.display_name,
    fs_name: `${seed.name}.rom`,
    fs_name_no_ext: seed.name ?? '',
    fs_name_no_tags: seed.name ?? '',
    fs_extension: 'rom',
    fs_path: `${platform.fs_slug}/${seed.name}.rom`,
    fs_size_bytes: 4_194_304,
    path_cover_small: `covers/${stem}-small.png`,
    path_cover_large: `covers/${stem}.png`,
    url_cover: null,
    path_video: null,
    regions: [],
    languages: [],
    tags: [],
    revision: null,
    crc_hash: null,
    md5_hash: null,
    sha1_hash: null,
    has_simple_single_file: true,
    has_nested_single_file: false,
    has_multiple_files: false,
    missing_from_fs: false,
    metadatum: {
      genres: [],
      franchises: [],
      companies: [],
      game_modes: [],
      age_ratings: [],
      player_count: '1',
      first_release_date: null,
      average_rating: null
    },
    rom_user: {
      id: seed.id,
      rom_id: seed.id,
      last_played: null,
      now_playing: false,
      backlogged: false,
      hidden: false,
      rating: 0,
      difficulty: 0,
      completion: 0,
      status: null
    },
    files: [
      {
        id: seed.id * 10,
        rom_id: seed.id,
        file_name: `${seed.name}.rom`,
        file_path: platform.fs_slug,
        file_size_bytes: 4_194_304,
        full_path: `${platform.fs_slug}/${seed.name}.rom`,
        category: null
      }
    ],
    merged_screenshots: [`screenshots/${stem}-1.png`, `screenshots/${stem}-2.png`],
    created_at: '2026-01-14T09:00:00Z',
    updated_at: '2026-08-02T18:20:00Z',
    ...seed
  }
}

/**
 * Deliberately uneven. One game has everything RomM can hold and one has almost
 * nothing, because those are the two ends the detail screen has to survive: a
 * full banner with a rating, a region and three genres, and a homebrew ROM
 * matched to no provider at all, whose banner has no artwork to draw.
 */
const ROMS: RommRom[] = [
  game({
    id: 1,
    name: 'Chrono Trigger',
    platform_id: 1,
    summary:
      'A party of travellers meets across four eras to stop a catastrophe none of them witnessed. ' +
      'Battles happen on the field rather than a separate screen, and the ending you reach depends ' +
      'on when you choose to face the thing at the end of it.',
    fs_size_bytes: 4_194_304,
    regions: ['USA'],
    languages: ['English'],
    revision: '1.1',
    tags: ['!'],
    metadatum: {
      genres: ['Role-playing', 'Adventure'],
      franchises: ['Chrono'],
      companies: ['Square'],
      game_modes: ['Single player'],
      age_ratings: ['Everyone'],
      player_count: '1',
      first_release_date: 794_448_000,
      average_rating: 92
    },
    rom_user: {
      id: 1,
      rom_id: 1,
      last_played: '2026-08-19T21:40:00Z',
      now_playing: false,
      backlogged: false,
      hidden: false,
      rating: 0,
      difficulty: 0,
      completion: 0,
      status: null
    }
  }),
  game({
    id: 2,
    name: 'Metal Gear Solid',
    platform_id: 2,
    summary: 'A infiltration of a nuclear disposal facility, told largely over the radio.',
    fs_size_bytes: 687_865_856,
    regions: ['Europe'],
    languages: ['English', 'French', 'German'],
    metadatum: {
      genres: ['Action', 'Stealth'],
      franchises: ['Metal Gear'],
      companies: ['Konami'],
      game_modes: ['Single player'],
      age_ratings: ['Mature'],
      player_count: '1',
      first_release_date: 907_200_000,
      average_rating: 89
    }
  }),
  game({
    id: 3,
    name: 'Super Metroid',
    platform_id: 1,
    summary: 'A planet mapped by walking into every wall until one of them opens.',
    regions: ['Japan', 'USA'],
    metadatum: {
      genres: ['Platform', 'Adventure'],
      franchises: ['Metroid'],
      companies: ['Nintendo', 'Intelligent Systems'],
      game_modes: ['Single player'],
      age_ratings: ['Everyone'],
      player_count: '1',
      first_release_date: 764_121_600,
      average_rating: 94
    }
  }),
  game({
    id: 4,
    name: 'Super Mario World',
    platform_id: 1,
    fs_size_bytes: 524_288,
    metadatum: {
      genres: ['Platform'],
      franchises: ['Super Mario'],
      companies: ['Nintendo'],
      game_modes: ['Single player', 'Multiplayer'],
      age_ratings: ['Everyone'],
      player_count: '2',
      first_release_date: 659_836_800,
      average_rating: 91
    }
  }),
  // A large, slow download, which is what the Switch row is here to draw. The
  // title is deliberately not a Nintendo first-party one: this is a public demo
  // page, and a Switch emulator shown downloading Nintendo's own game is the one
  // pairing that has actually been litigated over.
  game({
    id: 5,
    name: 'The Witcher 3: Wild Hunt',
    platform_id: 3,
    summary: 'A hundred hours of contract work, most of it about people rather than monsters.',
    fs_size_bytes: 14_495_514_624,
    metadatum: {
      genres: ['Role-playing'],
      franchises: ['The Witcher'],
      companies: ['CD Projekt Red'],
      game_modes: ['Single player'],
      age_ratings: ['Mature'],
      player_count: '1',
      first_release_date: 1_571_097_600,
      average_rating: 94
    }
  }),
  // No artwork, no metadata, no summary: the game the banner has to fall back
  // on, and the Details tab has to admit it knows nothing about.
  game({
    id: 6,
    name: 'Untitled Homebrew Demo',
    platform_id: 1,
    fs_size_bytes: 32_768,
    path_cover_small: null,
    path_cover_large: null,
    merged_screenshots: []
  })
]

const romById = (id: number): RommRom => ROMS.find((rom) => rom.id === id) ?? ROMS[0]

const INSTALLED: InstalledRom[] = [1, 3, 6].map((id) => {
  const rom = romById(id)
  return {
    romId: id,
    path: `/home/deck/retrodeck/roms/snes/${rom.fs_name}`,
    launchPath: `/home/deck/retrodeck/roms/snes/${rom.fs_name}`,
    name: rom.name ?? rom.fs_name,
    coverPath: rom.path_cover_small,
    files: [rom.fs_name],
    system: 'snes',
    platformName: rom.platform_display_name,
    fileName: rom.fs_name,
    sizeBytes: rom.fs_size_bytes,
    installedAt: '2026-08-18T20:11:00Z',
    isDirectory: false,
    emulatorId: 'retrodeck'
  }
})

/** A queue with one of everything, so the Downloads screen has all its rows. */
const DOWNLOADS: DownloadItem[] = [
  {
    romId: 2,
    name: 'Metal Gear Solid',
    coverPath: romById(2).path_cover_small,
    system: 'psx',
    platformName: 'PlayStation',
    state: 'downloading',
    receivedBytes: 262_144_000,
    totalBytes: 687_865_856,
    error: null,
    targetPath: '/home/deck/retrodeck/roms/psx/Metal Gear Solid.chd'
  },
  {
    romId: 5,
    name: 'The Witcher 3: Wild Hunt',
    coverPath: romById(5).path_cover_small,
    system: 'switch',
    platformName: 'Nintendo Switch',
    state: 'queued',
    receivedBytes: 0,
    totalBytes: 14_495_514_624,
    error: null,
    targetPath: '/home/deck/Emulation/roms/switch/witcher3.nsp'
  },
  {
    romId: 1,
    name: 'Chrono Trigger',
    coverPath: romById(1).path_cover_small,
    system: 'snes',
    platformName: 'Super Nintendo',
    state: 'done',
    receivedBytes: 4_194_304,
    totalBytes: 4_194_304,
    error: null,
    targetPath: '/home/deck/retrodeck/roms/snes/Chrono Trigger.sfc'
  },
  {
    romId: 4,
    name: 'Super Mario World',
    coverPath: romById(4).path_cover_small,
    system: 'snes',
    platformName: 'Super Nintendo',
    state: 'error',
    receivedBytes: 0,
    totalBytes: 524_288,
    error: 'The server closed the connection before the file was complete.',
    targetPath: '/home/deck/retrodeck/roms/snes/Super Mario World.sfc'
  }
]

/** One row of every sync state, which is the whole subject of the Saves tab. */
const SAVES: SaveAsset[] = [
  {
    id: 11,
    kind: 'save',
    fileName: 'Chrono Trigger.srm',
    sizeBytes: 8192,
    emulator: 'snes9x',
    localPath: '/home/deck/retrodeck/saves/snes/Chrono Trigger.srm',
    localModifiedAt: '2026-08-19T21:58:00Z',
    fromThisDevice: true,
    updatedAt: '2026-08-19T21:59:00Z',
    sync: 'synced'
  },
  {
    id: null,
    kind: 'state',
    fileName: 'Chrono Trigger.state1',
    sizeBytes: 401_408,
    emulator: 'snes9x',
    localPath: '/home/deck/retrodeck/states/snes/Chrono Trigger.state1',
    localModifiedAt: '2026-08-20T22:04:00Z',
    fromThisDevice: null,
    updatedAt: null,
    sync: 'local-only'
  },
  {
    id: 13,
    kind: 'save',
    fileName: 'Chrono Trigger (handheld).srm',
    sizeBytes: 8192,
    emulator: 'snes9x',
    localPath: null,
    localModifiedAt: null,
    fromThisDevice: false,
    updatedAt: '2026-08-21T08:30:00Z',
    sync: 'remote-only'
  }
]

/**
 * The BIOS situation, with the file names and notes RomMix genuinely knows —
 * `BIOS_REQUIREMENTS` in `@config/bios` is where these come from.
 *
 * Arranged so the screen has one of each state to draw: a required file that is
 * missing and fetchable, an optional one already in place, a file the server
 * does not hold at all, a console whose BIOS is a dump RomMix cannot name and so
 * carries a setup note, one staged into RomMix's own folder rather than the
 * emulator's, and a platform that needs nothing — which the screen drops, since
 * a console with nothing to say should not take a row.
 *
 * The missing `scph5501.bin` is also what raises the warning on the detail page
 * of a PlayStation game: that path reads this same list.
 */
const BIOS: BiosPlatform[] = [
  {
    platformId: 2,
    platformSlug: 'ps',
    platformName: 'PlayStation',
    system: 'psx',
    emulatorId: 'retrodeck',
    emulatorName: 'RetroDECK',
    biosDir: '/home/deck/retrodeck/bios',
    stagingNote: null,
    blockedReason: null,
    setupNote: null,
    items: [
      {
        fileName: 'scph5500.bin',
        note: 'PlayStation BIOS — Japan',
        required: false,
        installed: false,
        dir: '/home/deck/retrodeck/bios',
        staged: false,
        firmwareId: 501,
        sizeBytes: 524_288,
        verified: true
      },
      {
        fileName: 'scph5501.bin',
        note: 'PlayStation BIOS — North America',
        required: true,
        installed: false,
        dir: '/home/deck/retrodeck/bios',
        staged: false,
        firmwareId: 502,
        sizeBytes: 524_288,
        verified: true
      },
      {
        fileName: 'scph5502.bin',
        note: 'PlayStation BIOS — Europe',
        required: false,
        installed: true,
        dir: '/home/deck/retrodeck/bios',
        staged: false,
        firmwareId: 503,
        sizeBytes: 524_288,
        verified: false
      }
    ]
  },
  {
    platformId: 3,
    platformSlug: 'switch',
    platformName: 'Nintendo Switch',
    system: 'switch',
    emulatorId: 'eden',
    emulatorName: 'Eden',
    biosDir: '/home/deck/.local/share/eden/keys',
    stagingNote:
      'title.keys was put in RomMix’s own folder: Eden reads keys from its data directory, ' +
      'which RomMix cannot write into while it is running. Copy it across and restart Eden.',
    blockedReason: null,
    setupNote: 'The Switch needs prod.keys and a firmware dump from a console.',
    items: [
      {
        fileName: 'prod.keys',
        note: 'Console master keys — nothing decrypts without them',
        required: true,
        installed: true,
        dir: '/home/deck/.local/share/eden/keys',
        staged: false,
        firmwareId: null,
        sizeBytes: 219_136,
        verified: false
      },
      {
        fileName: 'title.keys',
        note: 'Per-title keys, for installed games, updates and DLC',
        required: true,
        installed: false,
        dir: '/home/deck/.local/share/rommix/bios/switch',
        staged: true,
        firmwareId: 504,
        sizeBytes: 41_216,
        verified: false
      }
    ]
  },
  // Nothing needed, nothing to say. Present because the real report carries
  // every platform on the server, and dropped by the screen itself.
  {
    platformId: 1,
    platformSlug: 'snes',
    platformName: 'Super Nintendo',
    system: 'snes',
    emulatorId: 'retrodeck',
    emulatorName: 'RetroDECK',
    biosDir: '/home/deck/retrodeck/bios',
    stagingNote: null,
    blockedReason: null,
    setupNote: null,
    items: []
  }
]

const SETTINGS: Settings = {
  systemEmulators: {},
  emulatorPaths: {},
  systemLaunchers: {},
  emulatorRoots: {},
  systemOverrides: {},
  emulatorPriority: [],
  syncSavesDown: true,
  syncSavesUp: true,
  confirmUninstall: true,
  confirmSavePush: false,
  dismissedNotices: [],
  uiScale: 0,
  deviceId: 'web-preview',
  deviceName: 'RomMix @ web preview'
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/** Every subscription, since nothing here ever emits. */
const noSubscription = (): (() => void) => () => {}

/** A call that takes a moment, so spinners and disabled buttons are visible. */
function later<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const favourites = new Set<number>([3])

const bridge: RomMixBridge = {
  server: {
    status: () =>
      later({
        connected: true,
        baseUrl: 'https://romm.example.org',
        user: {
          id: 1,
          username: 'preview',
          email: null,
          enabled: true,
          role: 'admin',
          oauth_scopes: [],
          avatar_path: ''
        },
        serverVersion: '5.1.0 (preview)',
        error: null
      }),
    connect: () => Promise.reject(new Error('Not available in the web preview')),
    disconnect: () => Promise.resolve(),
    startPairing: () => Promise.reject(new Error('Not available in the web preview')),
    pollPairing: () => Promise.resolve(false)
  },
  library: {
    platforms: () => later(PLATFORMS),
    collections: () => later([]),
    roms: (query: RomQuery) => {
      const term = query.search_term?.toLowerCase() ?? ''
      const matched = ROMS.filter((rom) => {
        if (term && !(rom.name ?? '').toLowerCase().includes(term)) return false
        if (query.platform_ids?.length && !query.platform_ids.includes(rom.platform_id))
          return false
        if (query.favorite && !favourites.has(rom.id)) return false
        if (query.last_played && !rom.rom_user.last_played) return false
        return true
      })
      const offset = query.offset ?? 0
      const limit = query.limit ?? 50
      return later({
        items: matched.slice(offset, offset + limit),
        total: matched.length,
        limit,
        offset
      })
    },
    rom: (id: number) => later(romById(id)),
    favourite: (romId: number) => later(favourites.has(romId)),
    setFavourite: (romId: number, favourite: boolean) => {
      if (favourite) favourites.add(romId)
      else favourites.delete(romId)
      return later(favourite)
    },
    installed: () => later(INSTALLED),
    sync: () => later({ checked: ROMS.length, removed: 0, adopted: 0 }, 900),
    onSyncProgress: noSubscription,
    onInstalledChanged: noSubscription,
    onAdopted: noSubscription
  },
  saves: {
    list: (romId: number) => later(romId === 1 ? SAVES : []),
    pull: () => later({ saves: 1, states: 0, skippedReason: null }, 600),
    push: () => later({ saves: 1, states: 1, skippedReason: null }, 600),
    pushPreview: () =>
      later({
        files: [
          {
            kind: 'save' as const,
            fileName: 'Chrono Trigger.srm',
            path: '/home/deck/retrodeck/saves/snes/Chrono Trigger.srm',
            sizeBytes: 8192,
            modifiedAt: '2026-08-19T21:58:00Z',
            emulator: 'snes9x',
            isDirectory: false,
            replaces: {
              sizeBytes: 8192,
              updatedAt: '2026-08-19T21:59:00Z',
              emulator: 'snes9x',
              fromThisDevice: true
            }
          }
        ],
        skippedReason: null,
        deviceName: SETTINGS.deviceName
      }),
    pushSelected: (_romId: number, paths: string[]) =>
      later({ saves: paths.length, states: 0, skippedReason: null }, 600),
    remove: () => later(undefined)
  },
  bios: {
    list: () => later({ platforms: BIOS }),
    platform: (platformId: number) =>
      later(BIOS.find((platform) => platform.platformId === platformId) ?? null),
    // Marked in place rather than refused: the screen reloads the report after
    // an install, so a row that never changes state makes the button look
    // broken. Nothing is written anywhere, and a reload puts it all back.
    install: (firmwareId: number) => {
      const item = BIOS.flatMap((platform) => platform.items).find(
        (candidate) => candidate.firmwareId === firmwareId
      )
      if (!item) return Promise.reject(new Error('No such firmware'))
      item.installed = true
      return later(`${item.dir}/${item.fileName}`, 500)
    },
    syncAll: (platformId?: number | null) => {
      const platforms = platformId ? BIOS.filter((p) => p.platformId === platformId) : BIOS
      const items = platforms.flatMap((platform) => platform.items)
      const outstanding = items.filter((item) => !item.installed)
      const fetchable = outstanding.filter((item) => item.firmwareId !== null)
      for (const item of fetchable) item.installed = true
      return later(
        {
          installed: fetchable.length,
          failed: 0,
          unavailable: outstanding.length - fetchable.length
        },
        900
      )
    },
    onProgress: noSubscription
  },
  downloads: {
    list: () => later(DOWNLOADS),
    start: (romId: number) => {
      const rom = romById(romId)
      return later({
        romId,
        name: rom.name ?? rom.fs_name,
        coverPath: rom.path_cover_small,
        system: 'snes',
        platformName: rom.platform_display_name,
        state: 'queued' as const,
        receivedBytes: 0,
        totalBytes: rom.fs_size_bytes,
        error: null,
        targetPath: `/home/deck/retrodeck/roms/snes/${rom.fs_name}`
      })
    },
    cancel: () => later(undefined),
    clearFinished: () => later(undefined),
    uninstall: () => later(undefined),
    onUpdate: noSubscription
  },
  game: {
    variants: (romId: number) =>
      later({
        system: 'snes',
        emulatorId: 'retrodeck',
        emulatorName: 'RetroDECK',
        setupNotes: [],
        // Two answers for one game only, so both the "Run with" button and its
        // absence can be seen.
        options:
          romId === 1
            ? [
                { id: 'snes9x', label: 'Snes9x' },
                { id: 'bsnes', label: 'bsnes', note: 'more accurate, heavier' }
              ]
            : [{ id: 'snes9x', label: 'Snes9x' }],
        chosen: null
      }),
    launch: () => Promise.reject(new Error('There is no emulator in the web preview')),
    stop: () => later(undefined),
    onState: noSubscription
  },
  system: {
    settings: () => later(SETTINGS),
    updateSettings: (patch) => later(Object.assign(SETTINGS, patch)),
    emulatorReleases: () => later([]),
    installEmulator: () => Promise.reject(new Error('Not available in the web preview')),
    installEmulatorFlatpak: () => Promise.reject(new Error('Not available in the web preview')),
    runEmulator: () => Promise.reject(new Error('Not available in the web preview')),
    onInstallProgress: noSubscription,
    diagnostics: () =>
      later({
        inFlatpak: false,
        canSpawnHost: false,
        emulators: [],
        romsWritable: true,
        notes: ['This is the web preview: nothing was actually checked.']
      }),
    root: () =>
      later({
        current: '~/.local/share/rommix',
        fallback: '~/.local/share/rommix',
        fromEnvironment: false
      }),
    setRoot: () => Promise.reject(new Error('Not available in the web preview')),
    restart: () => later(undefined),
    /**
     * Console logos resolve to null so the app falls back to its own platform
     * badge — the short code on a generated colour — rather than showing five
     * identical placeholder squares where the consoles should be. Everything
     * else gets art keyed to its path.
     */
    imageUrl: (path: string | null) => {
      if (!path) return null
      if (path.includes('/assets/platforms/')) return null
      const name =
        path
          .split('/')
          .pop()
          ?.replace(/\.[a-z]+$/i, '') ?? path
      return placeholderArt(path, name.slice(0, 22))
    },
    toggleFullscreen: () => later(false),
    quit: () => later(undefined),
    onError: noSubscription
  }
}

/** Put the stub in place. Called from `main.tsx` before anything renders. */
export function installPreviewBridge(): void {
  window.rommix = bridge
  // Said once, in the one place a developer will look when something behaves
  // oddly here and not in the app.
  console.info('[rommix] web preview: window.rommix is a stub, no server is involved')
}

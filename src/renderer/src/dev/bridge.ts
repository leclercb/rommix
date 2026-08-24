import { artFor, PLATFORMS, ROMS as LIBRARY } from './library'
import type { RomMixBridge } from '@shared/api'
import type {
  BiosPlatform,
  DownloadItem,
  InstalledRom,
  RommRom,
  RomQuery,
  SaveAsset,
  Settings
} from '@shared/types'

/**
 * A `window.rommix` for the browser — `npm run preview:app` and the demo
 * published beside the site.
 *
 * There is no preload script outside Electron, so the front end would fail on
 * its first call. This answers every one of them from the library in
 * `library.ts`, which is a transcript of RomM's own public demo server: 25
 * homebrew and freeware games across 13 systems, with their real metadata and
 * their real cover art. A front end for a ROM library is judged on how a real
 * library looks in it, and an invented one flatters the layout — every title the
 * same length, every cover the same shape.
 *
 * It is a mannequin, not a simulator. Nothing is persisted, nothing reaches a
 * RomM server, and the actions that would touch a disk or an emulator report
 * plausible success without doing anything. Judge layout and navigation here;
 * judge behaviour in the real app.
 *
 * The module is imported only under the `VITE_WEB_PREVIEW` flag that
 * `vite.web.config.ts` sets, so it is never part of a shipped bundle.
 */

/**
 * The folder the real app keeps everything in, as `root.ts` resolves it with
 * nothing configured.
 *
 * Written out rather than imported: `root.ts` is main-process code and reaches
 * for `node:os`, which a browser build cannot take. Kept correct because this
 * is the one path the demo prints, the README's "Where your files go" table
 * names the same folder, and a demo quoting a different one is a documented
 * answer contradicted by the thing that is supposed to be showing it.
 */
const PREVIEW_ROOT = '~/rommix'

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

/**
 * A game with nothing known about it, which the harvested library has none of:
 * every row on RomM's demo is scraped and carries art. The game screen has a
 * banner that has to survive having no artwork to draw and a Details tab that
 * has to admit it knows nothing, and those two states are only reachable from an
 * entry like this one — so it is invented, and named so that nobody mistakes it
 * for something that was on the server.
 */
const UNMATCHED: RommRom = {
  id: 9001,
  name: 'Untitled Homebrew Demo',
  slug: null,
  summary: null,
  platform_id: 9,
  platform_slug: 'nes',
  platform_fs_slug: 'nes',
  platform_display_name: 'Nintendo Entertainment System',
  fs_name: 'untitled-demo.nes',
  fs_name_no_ext: 'untitled-demo',
  fs_name_no_tags: 'untitled-demo',
  fs_extension: 'nes',
  fs_path: 'roms/nes',
  fs_size_bytes: 32_768,
  path_cover_small: null,
  path_cover_large: null,
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
    id: 9001,
    rom_id: 9001,
    last_played: null,
    now_playing: false,
    backlogged: false,
    hidden: false,
    rating: 0,
    difficulty: 0,
    completion: 0,
    status: null
  },
  files: [],
  merged_screenshots: [],
  created_at: '2026-08-18T20:11:00Z',
  updated_at: '2026-08-18T20:11:00Z'
}

/** Cave Story, which the Home screen shows as the game last played. */
const CAVE_STORY = 175

const ROMS: RommRom[] = [
  ...LIBRARY.map((rom) =>
    rom.id === CAVE_STORY
      ? { ...rom, rom_user: { ...rom.rom_user, last_played: '2026-08-19T21:40:00Z' } }
      : rom
  ),
  UNMATCHED
]

const romById = (id: number): RommRom => ROMS.find((rom) => rom.id === id) ?? ROMS[0]

/** ES-DE system folder per RomM platform, for the paths shown on screen. */
const SYSTEMS: Readonly<Record<string, string>> = {
  atari2600: 'atari2600',
  atari7800: 'atari7800',
  c64: 'c64',
  dos: 'dos',
  gamegear: 'gamegear',
  gb: 'gb',
  gba: 'gba',
  gbc: 'gbc',
  genesis: 'genesis',
  nes: 'nes',
  scummvm: 'scummvm',
  sms: 'mastersystem',
  snes: 'snes'
}

const systemOf = (rom: RommRom): string => SYSTEMS[rom.platform_slug] ?? rom.platform_fs_slug

/**
 * What is on this machine, newest install first — the `Ready to play` shelf.
 *
 * The order is the timestamps, not the array: Home sorts the index by
 * `installedAt` descending, so each entry carries its own rather than sharing
 * one and leaving the shelf at the mercy of a stable sort.
 *
 * Seven systems in seven rows, which is the point of the list: the shelf is the
 * one place a mixed library is seen all at once, and a set that was three games
 * on three Nintendo systems showed none of that. Cave Story is last because it
 * is the hero above the shelf, and a game shown twice at the top of the screen
 * reads as a bug.
 *
 * Nothing here is in the download queue below: a game cannot be both on disk
 * and still arriving.
 */
const INSTALLED: InstalledRom[] = (
  [
    [169, '2026-08-21T19:42:00Z'],
    [123, '2026-08-21T18:10:00Z'],
    [77, '2026-08-20T22:05:00Z'],
    [163, '2026-08-20T14:30:00Z'],
    [137, '2026-08-19T20:55:00Z'],
    [139, '2026-08-19T09:15:00Z'],
    [CAVE_STORY, '2026-08-18T20:11:00Z']
  ] as const
).map(([id, installedAt]) => {
  const rom = romById(id)
  const system = systemOf(rom)
  return {
    romId: id,
    path: `/home/deck/retrodeck/roms/${system}/${rom.fs_name}`,
    launchPath: `/home/deck/retrodeck/roms/${system}/${rom.fs_name}`,
    name: rom.name ?? rom.fs_name,
    coverPath: rom.path_cover_small,
    files: [rom.fs_name],
    system,
    platformName: rom.platform_display_name,
    fileName: rom.fs_name,
    sizeBytes: rom.fs_size_bytes,
    installedAt,
    isDirectory: false,
    emulatorId: 'retrodeck'
  }
})

/** A queue with one of everything, so the Downloads screen has all its rows. */
function queued(id: number, state: DownloadItem['state'], received: number): DownloadItem {
  const rom = romById(id)
  const system = systemOf(rom)
  return {
    romId: id,
    name: rom.name ?? rom.fs_name,
    coverPath: rom.path_cover_small,
    system,
    platformName: rom.platform_display_name,
    state,
    receivedBytes: received,
    totalBytes: rom.fs_size_bytes,
    error:
      state === 'error' ? 'The server closed the connection before the file was complete.' : null,
    targetPath: `/home/deck/retrodeck/roms/${system}/${rom.fs_name}`
  }
}

const DOWNLOADS: DownloadItem[] = [
  // Four games none of which are in `INSTALLED`, the finished one excepted:
  // that is what `done` means, and it is why Beneath a Steel Sky is on the
  // shelf above. At 69 MB it is also the only game here big enough to have been
  // worth watching arrive, so it is the one the queue remembers.
  queued(83, 'downloading', 1_500_000),
  queued(144, 'queued', 0),
  queued(139, 'done', romById(139).fs_size_bytes),
  queued(95, 'error', 0)
]

/** One row of every sync state, which is the whole subject of the Saves tab. */
const SAVES: SaveAsset[] = [
  {
    id: 11,
    kind: 'save',
    fileName: 'cavestory.srm',
    sizeBytes: 8192,
    emulator: 'genesis_plus_gx',
    localPath: '/home/deck/retrodeck/saves/genesis/cavestory.srm',
    localModifiedAt: '2026-08-19T21:58:00Z',
    fromThisDevice: true,
    updatedAt: '2026-08-19T21:59:00Z',
    sync: 'synced'
  },
  {
    id: null,
    kind: 'state',
    fileName: 'cavestory.state1',
    sizeBytes: 401_408,
    emulator: 'genesis_plus_gx',
    localPath: '/home/deck/retrodeck/states/genesis/cavestory.state1',
    localModifiedAt: '2026-08-20T22:04:00Z',
    fromThisDevice: null,
    updatedAt: null,
    sync: 'local-only'
  },
  {
    id: 13,
    kind: 'save',
    fileName: 'cavestory (handheld).srm',
    sizeBytes: 8192,
    emulator: 'genesis_plus_gx',
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
 * Thinner than the screen can render, and honestly so: this library is homebrew
 * for thirteen 8- and 16-bit systems, and only two of them take a BIOS file at
 * all. The states that need a console RomMix cannot place a dump for, or a file
 * staged into RomMix's own folder because the emulator's tree cannot be written
 * into, belong to the Switch and the PS3 and are not reachable from here. They
 * are worth seeing in the real app rather than inventing a platform for.
 */
const BIOS: BiosPlatform[] = [
  {
    platformId: 6,
    platformSlug: 'gba',
    platformName: 'Game Boy Advance',
    system: 'gba',
    emulatorId: 'retrodeck',
    emulatorName: 'RetroDECK',
    biosDir: '/home/deck/retrodeck/bios',
    stagingNote: null,
    blockedReason: null,
    setupNote: null,
    items: [
      {
        fileName: 'gba_bios.bin',
        note: 'Game Boy Advance BIOS — improves accuracy',
        required: false,
        installed: false,
        dir: '/home/deck/retrodeck/bios',
        staged: false,
        firmwareId: 501,
        sizeBytes: 16_384,
        verified: true
      }
    ]
  },
  {
    platformId: 2,
    platformSlug: 'atari7800',
    platformName: 'Atari 7800',
    system: 'atari7800',
    emulatorId: 'retrodeck',
    emulatorName: 'RetroDECK',
    biosDir: '/home/deck/retrodeck/bios',
    stagingNote: null,
    blockedReason: null,
    setupNote: null,
    items: [
      {
        fileName: '7800 BIOS (U).rom',
        note: 'Atari 7800 BIOS — North America',
        required: false,
        installed: true,
        dir: '/home/deck/retrodeck/bios',
        staged: false,
        firmwareId: 502,
        sizeBytes: 4096,
        verified: false
      }
    ]
  },
  // Nothing needed, nothing to say. Present because the real report carries
  // every platform on the server, and dropped by the screen itself.
  {
    platformId: 9,
    platformSlug: 'nes',
    platformName: 'Nintendo Entertainment System',
    system: 'nes',
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
  romStorage: 'emulator',
  // The demo starts past the first-run wizard: it exists to show the app, and
  // a preview that opens on "how big would you like the text" shows the setup.
  setupComplete: true,
  syncSavesDown: true,
  syncSavesUp: true,
  confirmUninstall: true,
  confirmSavePush: true,
  dismissedNotices: [],
  // 0 is "measure the screen", which is what a browser at any size wants.
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

/**
 * Someone's picks, which is a shelf of its own on Home.
 *
 * Five games on five systems, of which only Cave Story and Battle Kid are also
 * on disk — so the shelf is not a second copy of `Ready to play`, and the dot
 * that marks a downloaded game means something, three of these lacking it.
 */
const favourites = new Set<number>([175, 123, 149, 99, 54])

const bridge: RomMixBridge = {
  server: {
    status: () =>
      later({
        connected: true,
        baseUrl: 'https://demo.romm.app',
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
    list: (romId: number) => later(romId === CAVE_STORY ? SAVES : []),
    pull: () => later({ saves: 1, states: 0, skippedReason: null }, 600),
    push: () => later({ saves: 1, states: 1, skippedReason: null }, 600),
    pushPreview: () =>
      later({
        files: [
          {
            kind: 'save' as const,
            fileName: 'cavestory.srm',
            path: '/home/deck/retrodeck/saves/genesis/cavestory.srm',
            sizeBytes: 8192,
            modifiedAt: '2026-08-19T21:58:00Z',
            emulator: 'genesis_plus_gx',
            isDirectory: false,
            replaces: {
              sizeBytes: 8192,
              updatedAt: '2026-08-19T21:59:00Z',
              emulator: 'genesis_plus_gx',
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
    start: (romId: number) => later(queued(romId, 'queued', 0)),
    cancel: () => later(undefined),
    clearFinished: () => later(undefined),
    uninstall: () => later(undefined),
    onUpdate: noSubscription
  },
  game: {
    variants: (romId: number) => {
      const rom = romById(romId)
      const system = systemOf(rom)
      return later({
        system,
        emulatorId: 'retrodeck',
        emulatorName: 'RetroDECK',
        setupNotes: [],
        // Two answers for the Mega Drive only, so both the "Run with" button
        // and its absence can be seen. Both are cores RetroDECK really ships.
        options:
          system === 'genesis'
            ? [
                { id: 'genesis_plus_gx', label: 'Genesis Plus GX' },
                { id: 'picodrive', label: 'PicoDrive', note: 'faster, less accurate' }
              ]
            : [{ id: 'default', label: 'RetroDECK’s choice' }],
        chosen: null
      })
    },
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
        flatpakAvailable: false,
        flathubConfigured: false,
        emulators: [],
        romsWritable: true,
        // The path the real app would print, though nothing writes to it here:
        // the panel shows it so a bug report can quote it, and a demo quoting a
        // folder RomMix does not use teaches the wrong one.
        logPath: `${PREVIEW_ROOT}/logs/rommix.log`,
        notes: ['This is the web preview: nothing was actually checked.']
      }),
    root: () =>
      later({
        current: PREVIEW_ROOT,
        fallback: PREVIEW_ROOT,
        fromEnvironment: false
      }),
    setRoot: () => Promise.reject(new Error('Not available in the web preview')),
    restart: () => later(undefined),
    /**
     * Cover art and screenshots resolve to the copies bundled with the preview;
     * anything else — the console logos RomMix would fetch from the server's own
     * icon set — resolves to null, so the app falls back to its platform badge
     * rather than drawing thirteen broken images.
     */
    imageUrl: (path: string | null) => artFor(path),
    toggleFullscreen: () => later(false),
    quit: () => later(undefined),
    // The preview is already in a browser, so the desktop's link handler is
    // simply a new tab.
    openExternal: (url: string) => {
      window.open(url, '_blank', 'noopener')
      return later(undefined)
    },
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

import { artFor, PLATFORMS, ROMS as LIBRARY } from './library'
import { createI18n, localeFor, type MessageKey } from '@shared/i18n'
import type { RomMixBridge } from '@shared/api'
import type {
  BiosPlatform,
  DownloadItem,
  InstalledRom,
  RommCollection,
  RommCollectionBase,
  RommVirtualCollection,
  RommRom,
  RomQuery,
  SaveAsset,
  Settings,
  UpdateStatus
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
 * RomM server, and nothing touches a disk or an emulator.
 *
 * What that leaves an action to do depends on what miming it would claim. A
 * BIOS file is in place or it is not, so `bios.install` marks it in place and
 * the screen is telling the truth. A transfer is not a state but a process: a
 * row that says it is downloading and never moves, or a Download button that
 * accepts the press, tells a visitor this page can fetch them a game. So the
 * things that would need a disk, a server or an emulator refuse instead, in the
 * app's own words and on the app's own error channel — see `refuse`. Judge
 * layout and navigation here; judge behaviour in the real app.
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

/**
 * When each of these was last played, newest first.
 *
 * A shelf is a shelf: one game on `Continue playing` shows the row working
 * without showing what it is *for*, which is picking up the thing you were in
 * the middle of from among the several you have going. Every one of them is in
 * `INSTALLED` — a game cannot be continued from a machine it is not on — and
 * Cave Story leads because the hero above the shelf is the first of them, and it
 * is the game the rest of the demo is written around.
 */
const PLAYED: Readonly<Record<number, string>> = {
  [CAVE_STORY]: '2026-08-21T21:40:00Z',
  169: '2026-08-21T18:05:00Z',
  137: '2026-08-20T22:30:00Z',
  123: '2026-08-19T20:15:00Z',
  163: '2026-08-17T09:50:00Z'
}

const ROMS: RommRom[] = [
  ...LIBRARY.map((rom) =>
    PLAYED[rom.id] ? { ...rom, rom_user: { ...rom.rom_user, last_played: PLAYED[rom.id] } } : rom
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

/**
 * How far through a game a row is, as a share of its own size.
 *
 * Written as a fraction rather than a number of bytes so a row cannot end up
 * further along than the game is big — the demo library is a real one, and its
 * games are of every size from a 128 KB cartridge upwards.
 */
function part(id: number, share: number): number {
  return Math.round(romById(id).fs_size_bytes * share)
}

/** A queue with one of everything, so the Downloads screen has all its rows. */
function queued(
  id: number,
  state: DownloadItem['state'],
  received: number,
  resumable = true
): DownloadItem {
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
    error: state === 'error' ? say('demo.connectionClosed') : null,
    targetPath: `/home/deck/retrodeck/roms/${system}/${rom.fs_name}`,
    resumable
  }
}

/**
 * Built on demand, not at module load.
 *
 * `queued` reaches `say`, which reads `SETTINGS` — declared further down this
 * file. Evaluating this list while the module was still initialising read that
 * `const` before it existed, and the demo died on load with a bare
 * ReferenceError. Building it per call also means the demo's own language
 * setting reaches these strings, which it could not when they were frozen at
 * import time.
 */
const downloadQueue = (): DownloadItem[] => [
  // Seven games none of which are in `INSTALLED`, the finished one excepted:
  // that is what `done` means, and it is why Beneath a Steel Sky is on the
  // shelf above. At 69 MB it is also the only game here big enough to have been
  // worth watching arrive, so it is the one the queue remembers.
  queued(83, 'downloading', 1_500_000),
  // One from a server that cannot send a game in pieces, which is the row that
  // offers Cancel and no Pause, and says why.
  queued(163, 'downloading', part(163, 0.55), false),
  // A disc set, fetched a track at a time: the row names the one arriving.
  { ...queued(154, 'downloading', part(154, 0.25)), currentFile: 'Track 02.bin' },
  queued(144, 'queued', 0),
  // A transfer the network took away, kept so it can be finished — the one row
  // on this screen that offers something to press other than Cancel.
  queued(149, 'paused', part(149, 0.4)),
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
const biosPlatforms = (): BiosPlatform[] => [
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
        note: say('bios.note.gbaBios'),
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
        note: say('bios.note.atari7800'),
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
  navigationSounds: true,
  confirmUninstall: true,
  confirmSavePush: true,
  dismissedNotices: [],
  // The browser's own language, so the published demo reads in whatever the
  // visitor's browser is set to — and the Settings row still switches it.
  language: 'auto',
  // 0 is "measure the screen", which is what a browser at any size wants.
  uiScale: 0,
  updates: 'auto',
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

/** Everyone listening on the channel the app reports failures over. */
const errorListeners = new Set<(message: string) => void>()

/**
 * Turn down something the demo cannot do, the way the app turns down anything
 * else that fails.
 *
 * Both halves are needed. Rejecting is what stops the caller announcing
 * success, since a screen only says "uninstalled" once the call has come back.
 * Saying it on the error channel is what the visitor actually sees: in the app
 * the main process has already reported the failure over `app:error` by the
 * time the promise rejects, so every one of these callers catches and says
 * nothing itself — the comment at each of them is some version of "reported
 * centrally". A stub that only rejects inherits all that silence, which is a
 * button that does nothing at all.
 */
function refuse<T>(key: MessageKey = 'demo.notAvailable'): Promise<T> {
  const message = say(key)
  for (const listener of errorListeners) listener(message)
  return Promise.reject(new Error(message))
}

/**
 * What the Settings screen prints about RomMix's own version.
 *
 * The version is the real one — `vite.web.config.ts` reads it out of
 * package.json — so the demo cannot end up claiming a release that does not
 * exist. Checked "just now", because a demo that says it last looked in 1970 is
 * showing a bug it does not have.
 */
function previewUpdate(): UpdateStatus {
  return {
    state: 'idle',
    current: import.meta.env.VITE_ROMMIX_VERSION ?? 'preview',
    latest: import.meta.env.VITE_ROMMIX_VERSION ?? 'preview',
    notes: null,
    url: 'https://github.com/leclercb/rommix/releases',
    receivedBytes: 0,
    totalBytes: 0,
    readyPath: null,
    blockedReason: say('demo.nothingToReplace'),
    restartBlocked: null,
    error: null,
    checkedAt: new Date().toISOString()
  }
}

/**
 * Someone's picks, which is a shelf of its own on Home.
 *
 * Five games on five systems, of which only Cave Story and Battle Kid are also
 * on disk — so the shelf is not a second copy of `Ready to play`, and the dot
 * that marks a downloaded game means something, three of these lacking it.
 */
const favourites = new Set<number>([175, 123, 149, 99, 54])

/**
 * A couple of shelves someone might have made, so the Collections page has
 * something to be.
 *
 * Membership is a live Set rather than a fixed list: the button on a game's
 * page writes to it, and the demo is worth nothing if pressing that button
 * changes nothing. Covers are left null — these are the user's own shelves and
 * RomM only has art for one if they uploaded it.
 */
const COLLECTIONS: {
  id: number
  name: string
  description: string
  roms: Set<number>
  virtual?: boolean
}[] = [
  { id: 9001, name: 'Rainy Sunday', description: 'Long ones', roms: new Set([175, 139, 137]) },
  { id: 9002, name: 'Show someone', description: 'Short and pretty', roms: new Set([169, 77]) },
  // One of RomM's own, so the switch that hides them has something to hide.
  {
    id: 9003,
    name: 'Platform',
    description: 'By genre',
    roms: new Set([123, 163, 77, 137]),
    virtual: true
  }
]

/** The shape both endpoints share, with the covers RomM sends for a mosaic. */
const shelf = (collection: (typeof COLLECTIONS)[number]): RommCollectionBase => ({
  name: collection.name,
  description: collection.description,
  rom_ids: [...collection.roms],
  rom_count: collection.roms.size,
  path_cover_small: null,
  path_cover_large: null,
  path_covers_small: [...collection.roms]
    .map((romId) => romById(romId).path_cover_small)
    .filter((path): path is string => Boolean(path))
    .slice(0, 4),
  path_covers_large: [],
  is_virtual: collection.virtual ?? false,
  is_favorite: false
})

const collectionList = (): RommCollection[] =>
  COLLECTIONS.filter((collection) => !collection.virtual).map((collection) => ({
    ...shelf(collection),
    id: collection.id
  }))

const virtualList = (): RommVirtualCollection[] =>
  COLLECTIONS.filter((collection) => collection.virtual).map((collection) => ({
    ...shelf(collection),
    id: `genre/${collection.name.toLowerCase()}`,
    type: 'genre'
  }))

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
    connect: () => Promise.reject(new Error(say('demo.notAvailable'))),
    disconnect: () => Promise.resolve(),
    startPairing: () => Promise.reject(new Error(say('demo.notAvailable'))),
    pollPairing: () => Promise.resolve(false)
  },
  library: {
    platforms: () => later(PLATFORMS),
    collections: () => later(collectionList()),
    virtualCollections: () => later(virtualList()),
    roms: (query: RomQuery) => {
      const term = query.search_term?.toLowerCase() ?? ''
      const matched = ROMS.filter((rom) => {
        if (term && !(rom.name ?? '').toLowerCase().includes(term)) return false
        if (query.platform_ids?.length && !query.platform_ids.includes(rom.platform_id))
          return false
        if (query.favorite && !favourites.has(rom.id)) return false
        if (query.collection_id != null) {
          const collection = COLLECTIONS.find((entry) => entry.id === query.collection_id)
          if (!collection?.roms.has(rom.id)) return false
        }
        if (query.virtual_collection_id != null) {
          const name = query.virtual_collection_id.split('/')[1]
          const collection = COLLECTIONS.find((entry) => entry.name.toLowerCase() === name)
          if (!collection?.roms.has(rom.id)) return false
        }
        if (query.last_played && !rom.rom_user.last_played) return false
        return true
      })
      /**
       * The one ordering a screen depends on, rather than every one RomM has.
       *
       * `Continue playing` asks for the most recent first, and a shelf that
       * came back in library order would put the game you played last week in
       * front of the one you left an hour ago. Everything else is asked for in
       * the order this library is already in.
       */
      const ordered =
        query.order_by === 'last_played'
          ? [...matched].sort((a, b) =>
              (b.rom_user.last_played ?? '').localeCompare(a.rom_user.last_played ?? '')
            )
          : matched

      const offset = query.offset ?? 0
      const limit = query.limit ?? 50
      return later({
        items: ordered.slice(offset, offset + limit),
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
    setCollection: (romId: number, collectionId: number, member: boolean) => {
      const collection = COLLECTIONS.find((entry) => entry.id === collectionId)
      if (member) collection?.roms.add(romId)
      else collection?.roms.delete(romId)
      return later(undefined)
    },
    installed: () => later(INSTALLED),
    files: (romId: number) => {
      const entry = INSTALLED.find((item) => item.romId === romId)
      return later(entry ? [{ name: entry.fileName, sizeBytes: entry.sizeBytes }] : [])
    },
    sync: () => later({ checked: ROMS.length, removed: 0, adopted: 0 }, 900),
    onSyncProgress: noSubscription,
    onInstalledChanged: noSubscription,
    onAdopted: noSubscription
  },
  saves: {
    list: (romId: number) => later(romId === CAVE_STORY ? SAVES : []),
    pull: () => refuse(),
    push: () => refuse(),
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
              fromThisDevice: true,
              isNewer: false
            }
          }
        ],
        skippedReason: null,
        deviceName: SETTINGS.deviceName
      }),
    pushSelected: () => refuse(),
    remove: () => refuse()
  },
  bios: {
    list: () => later({ platforms: biosPlatforms() }),
    platform: (platformId: number) =>
      later(biosPlatforms().find((platform) => platform.platformId === platformId) ?? null),
    // Marked in place rather than refused: the screen reloads the report after
    // an install, so a row that never changes state makes the button look
    // broken. Nothing is written anywhere, and a reload puts it all back.
    install: (firmwareId: number) => {
      const item = biosPlatforms()
        .flatMap((platform) => platform.items)
        .find((candidate) => candidate.firmwareId === firmwareId)
      if (!item) return refuse('demo.noFirmware')
      item.installed = true
      return later(`${item.dir}/${item.fileName}`, 500)
    },
    syncAll: (platformId?: number | null) => {
      const all = biosPlatforms()
      const platforms = platformId ? all.filter((p) => p.platformId === platformId) : all
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
    /**
     * A queue that stands still.
     *
     * Every row the screen can draw is in it, which is the point — but nothing
     * transfers, so nothing advances and nothing arrives. `onUpdate` never
     * emits for the same reason: there is no progress to report, and a stub
     * that invented some would be inventing the one thing this cannot show.
     */
    list: () => later(downloadQueue()),
    start: () => refuse(),
    pause: () => refuse(),
    cancel: () => refuse(),
    clearFinished: () => refuse(),
    uninstall: () => refuse(),
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
                { id: 'picodrive', label: 'PicoDrive', note: say('demo.variantFaster') }
              ]
            : [{ id: 'default', label: say('demo.variantDefault') }],
        chosen: null
      })
    },
    launch: () => refuse('demo.noEmulator')
  },
  running: {
    stop: () => later(undefined),
    forceStop: () => later(undefined),
    onState: noSubscription
  },
  updates: {
    /**
     * Up to date, and unable to be anything else.
     *
     * The demo does not invent a new version: the panel's interesting states
     * are a download and a restart, and a page that offers a fictional 0.9.0
     * behind a button that cannot fetch it is a worse demonstration than an
     * honest "nothing to do". The reason it cannot is the one the real app
     * gives for any copy that is not an AppImage.
     */
    status: () => later(previewUpdate()),
    check: () => later(previewUpdate(), 700),
    download: () => refuse(),
    restart: () => refuse(),
    onStatus: noSubscription
  },
  system: {
    settings: () => later(SETTINGS),
    updateSettings: (patch) => {
      Object.assign(SETTINGS, patch)
      // The tab follows the language too: in the app nobody ever sees the
      // title, but the demo is a page in a browser and it is the only name it
      // has once the link has been shared.
      if ('language' in patch) describePage()
      return later(SETTINGS)
    },
    emulatorReleases: () => later([]),
    installEmulator: () => refuse(),
    installEmulatorFlatpak: () => refuse(),
    runEmulator: () => refuse(),
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
        notes: [say('demo.nothingChecked')]
      }),
    root: () =>
      later({
        current: PREVIEW_ROOT,
        fallback: PREVIEW_ROOT,
        fromEnvironment: false
      }),
    setRoot: () => refuse(),
    restart: () => later(undefined),
    /**
     * Cover art and screenshots resolve to the copies bundled with the preview;
     * anything else — the console logos RomMix would fetch from the server's own
     * icon set — resolves to null, so the app falls back to its platform badge
     * rather than drawing thirteen broken images.
     */
    imageUrl: (path: string | null) => artFor(path),
    toggleFullscreen: () => later(false),
    quit: () => refuse(),
    // The preview is already in a browser, so the desktop's link handler is
    // simply a new tab.
    openExternal: (url: string) => {
      window.open(url, '_blank', 'noopener')
      return later(undefined)
    },
    onError: (listener) => {
      errorListeners.add(listener)
      return () => {
        errorListeners.delete(listener)
      }
    }
  }
}

/** Put the stub in place. Called from `main.tsx` before anything renders. */
/**
 * Name the page in whatever language it is about to be drawn in.
 *
 * `vite.web.config.ts` writes an English title and description into the
 * document, which is what a crawler unfurling the link reads — a single static
 * build can only carry one, and English is the one the rest of the world falls
 * back to. This is the copy for the person actually looking at it, which is a
 * different question and has a locale to answer it with.
 */
/**
 * The stub's own words, in whatever language the demo is being read in.
 *
 * The bridge stands in for the main process, so it answers the same way that
 * does: a sentence, already translated, never a key. Resolved per call rather
 * than once, because the demo's Settings can change the language under it.
 */
function say(key: MessageKey): string {
  // Never during module initialisation: `SETTINGS` is a `const` below this
  // point in the file, and reading it before the module has finished loading
  // throws. Anything a top-level value needs from here has to be built lazily
  // — see `downloadQueue` and `biosPlatforms`.
  return createI18n(localeFor(SETTINGS.language, navigator.language)).t(key)
}

function describePage(): void {
  const { t } = createI18n(localeFor(SETTINGS.language, navigator.language))
  document.title = t('demo.title')
  const description = document.querySelector('meta[name="description"]')
  if (description) description.setAttribute('content', t('demo.description'))
}

export function installPreviewBridge(): void {
  window.rommix = bridge
  describePage()
  // Said once, in the one place a developer will look when something behaves
  // oddly here and not in the app.
  console.info('[rommix] web preview: window.rommix is a stub, no server is involved')
}

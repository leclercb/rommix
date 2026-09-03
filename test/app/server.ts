import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type {
  RommCollection,
  RommDevice,
  RommFirmware,
  RommPlatform,
  RommRom,
  RommRomPage,
  RommSave,
  RommState,
  RommUser,
  RommVirtualCollection
} from '@shared/types'

/**
 * A RomM that only exists for the duration of a test.
 *
 * Enough of the API to sign in, draw a library, download a game and report a
 * session — which is the path everything else in RomMix hangs off. It is not a
 * reimplementation of RomM and is not trying to be: what it is for is the
 * wiring on RomMix's own side, where a channel renamed in `src/main/ipc/` and
 * not in `src/preload/` lives, and none of that cares whether the answers came
 * from a real server.
 *
 * The bodies are typed as the same `@shared/types` the app reads, so a field
 * this file forgets is a compile error rather than an `undefined` three screens
 * later — and a field RomM renames breaks the fake at the same moment it breaks
 * the client. What it cannot check is whether those types describe RomM at all;
 * that is `src/shared/types/romm.test.ts`, against the real schema.
 *
 * Ranges are answered properly, because a transfer that can be resumed is a
 * different code path in `transfer.ts` from one that cannot, and the resumable
 * one is what a real RomM offers for a single-file game.
 */

/** One request, as the test can ask about it afterwards. */
export interface Asked {
  method: string
  /** Path with the query string, which is most of what RomMix says. */
  path: string
  authorization: string | null
  /** The range asked for, where one was — how a resumed transfer shows itself. */
  range: string | null
  body: string
}

export interface FakeRomm {
  baseUrl: string
  /**
   * Put a save on the server, as another device would have.
   *
   * `emulator` is what decides whether RomMix will take it: a save tagged for
   * one emulator is never dropped into another's folder, so a tag that does not
   * match is a pull that correctly does nothing.
   */
  holdSave: (save: { romId: number; fileName: string; emulator: string; content: string }) => void
  /** Saves this server was sent, in order. */
  uploaded: { romId: number; emulator: string | null; deviceId: string | null; body: string }[]
  /** Every request, in order. */
  asked: Asked[]
  /** The token a client must present. See `seedCredentials`. */
  token: string
  /** The library it serves, for a test that wants to assert against it. */
  roms: RommRom[]
  /** The platforms it serves, likewise. */
  platforms: RommPlatform[]
  /** The shelves it serves, for a test that wants to assert against them. */
  collections: RommCollection[]
  /** The ones RomM derives from metadata, likewise. */
  virtualCollections: RommVirtualCollection[]
  /** The RomM version it reports, which is what a client shows as the server's. */
  version: string
  close: () => Promise<void>
}

const VERSION = '5.1.0'
const TOKEN = 'rmm_fake_token_for_tests'

/** The bytes of the one game that can be downloaded, and its digest. */
const ROM_BYTES = Buffer.from('RomMix integration test ROM\n'.repeat(64))
const ROM_MD5 = createHash('md5').update(ROM_BYTES).digest('hex')

/**
 * A game big enough, and served slowly enough, to be caught half-way.
 *
 * Everything else here answers instantly, which is right for a test about what
 * RomMix does with an answer and useless for one about interrupting it: a
 * transfer that is over before the first key press cannot be paused. Two
 * megabytes in small pieces is a couple of seconds — long enough to press
 * something, short enough that nobody waits for it.
 */
const SLOW_ROM_BYTES = Buffer.alloc(2 * 1024 * 1024, 'RomMix slow transfer test\n')
const SLOW_ROM_MD5 = createHash('md5').update(SLOW_ROM_BYTES).digest('hex')

/** How the slow game is broken up, and the pause between pieces. */
const SLOW_CHUNK = 32 * 1024
const SLOW_CHUNK_MS = 30

/**
 * Dribble the bytes out, stopping if the other end goes away.
 *
 * Only for a request with no range on it — the first attempt. A resumed one is
 * answered at full speed: what it is there to prove is that the range was
 * asked for and honoured, and making the test wait through the rest of the
 * file a second time proves nothing further.
 */
function serveSlowly(res: ServerResponse, bytes: Buffer): void {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': bytes.length,
    'Accept-Ranges': 'bytes'
  })
  let at = 0
  const timer = setInterval(() => {
    if (at >= bytes.length) {
      clearInterval(timer)
      res.end()
      return
    }
    res.write(bytes.subarray(at, at + SLOW_CHUNK))
    at += SLOW_CHUNK
  }, SLOW_CHUNK_MS)
  // The response, not the request: a GET's request body ends the moment it
  // arrives, so watching that stops the timer before a single chunk goes out.
  // A pause aborts the transfer, and a timer still writing into a closed socket
  // is an unhandled error that takes the fake down with it.
  res.on('close', () => clearInterval(timer))
}

/** The bytes of one file of a game made of several. */
function bytesFor(fileName: string): Buffer {
  return Buffer.from(`RomMix integration test — ${fileName}\n`.repeat(16))
}

function platform(id: number, slug: string, name: string, folder = slug): RommPlatform {
  return {
    id,
    slug,
    fs_slug: folder,
    name,
    display_name: name,
    custom_name: null,
    rom_count: 1,
    fs_size_bytes: ROM_BYTES.length,
    url_logo: null,
    missing_from_fs: false
  }
}

function rom(id: number, name: string, host: RommPlatform, fsName: string): RommRom {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    summary: `${name}, served by the fake RomM.`,
    platform_id: host.id,
    platform_slug: host.slug,
    platform_fs_slug: host.fs_slug,
    platform_display_name: host.display_name,
    fs_name: fsName,
    fs_name_no_ext: fsName.replace(/\.[^.]+$/, ''),
    fs_name_no_tags: fsName.replace(/\.[^.]+$/, ''),
    fs_extension: fsName.split('.').pop() ?? '',
    fs_path: `${host.fs_slug}/${fsName}`,
    fs_size_bytes: ROM_BYTES.length,
    path_cover_small: null,
    path_cover_large: null,
    url_cover: null,
    path_video: null,
    regions: ['USA'],
    languages: ['en'],
    tags: [],
    revision: null,
    crc_hash: null,
    // The digest of what this server actually serves, so the check in
    // `transfer.ts` passes for the right reason rather than being skipped.
    md5_hash: ROM_MD5,
    sha1_hash: null,
    has_simple_single_file: true,
    has_nested_single_file: false,
    has_multiple_files: false,
    missing_from_fs: false,
    metadatum: {
      genres: ['Platform'],
      franchises: [],
      companies: [],
      game_modes: ['Single player'],
      age_ratings: [],
      player_count: '1',
      first_release_date: Date.UTC(1991, 5, 23),
      average_rating: null
    },
    rom_user: {
      id: id * 100,
      rom_id: id,
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
        id: id * 10,
        rom_id: id,
        file_name: fsName,
        file_path: `${host.fs_slug}/`,
        file_size_bytes: ROM_BYTES.length,
        full_path: `${host.fs_slug}/${fsName}`,
        category: null,
        crc_hash: null,
        md5_hash: ROM_MD5,
        sha1_hash: null
      }
    ],
    merged_screenshots: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
}

/**
 * A game RomM holds as several files.
 *
 * Faithful in the part that matters: RomMix asks for these one at a time,
 * through the per-file endpoint, because they are ordinary files on the
 * server's disk. What this fake cannot stand in for is the other path — a
 * server too old for that endpoint builds an archive per request, which is not
 * the same size twice and has nothing to seek into. See TODO.md.
 */
function discSet(id: number, name: string, host: RommPlatform, folder: string): RommRom {
  const parts = [`${folder}.cue`, `${folder} (Track 1).bin`]
  const whole = rom(id, name, host, `${folder}.cue`)
  return {
    ...whole,
    fs_name_no_ext: folder,
    has_simple_single_file: false,
    has_multiple_files: true,
    // No digest on the game itself: what the content endpoint would serve for
    // one of these is an archive, and the hashes RomM holds describe neither
    // that archive nor any one file in it. Each file carries its own below.
    md5_hash: null,
    fs_size_bytes: parts.reduce((sum, part) => sum + bytesFor(part).length, 0),
    files: parts.map((fileName, at) => ({
      id: id * 10 + at,
      rom_id: id,
      file_name: fileName,
      file_path: `${host.fs_slug}/${folder}/`,
      file_size_bytes: bytesFor(fileName).length,
      full_path: `${host.fs_slug}/${folder}/${fileName}`,
      category: null,
      crc_hash: null,
      md5_hash: createHash('md5').update(bytesFor(fileName)).digest('hex'),
      sha1_hash: null
    }))
  }
}

/** A BIOS file the server holds, with the digest of what it will serve. */
function firmware(id: number, fileName: string): { item: RommFirmware; content: Buffer } {
  const content = Buffer.from(`RomMix integration test firmware — ${fileName}\n`)
  return {
    content,
    item: {
      id,
      file_name: fileName,
      file_name_no_ext: fileName.replace(/\.[^.]+$/, ''),
      file_extension: fileName.split('.').pop() ?? '',
      file_size_bytes: content.length,
      is_verified: true,
      // Checked before the file is allowed to stand: a BIOS that is the wrong
      // bytes is a console that hangs on a black screen, and nothing on the way
      // to that names the file.
      md5_hash: createHash('md5').update(content).digest('hex'),
      missing_from_fs: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z'
    }
  }
}

const user: RommUser = {
  id: 1,
  username: 'tester',
  email: null,
  enabled: true,
  role: 'admin',
  oauth_scopes: [],
  avatar_path: ''
}

/**
 * Answer a content request, honouring a range if one was asked for.
 *
 * The 206 is the point: `RommClient.supportsRange` probes for it before every
 * transfer, and what it answers decides whether the screen offers Pause at all.
 * A fake that always sent 200 would quietly test only the path RomMix takes
 * against an old server.
 */
function serveBytes(req: IncomingMessage, res: ServerResponse, bytes: Buffer): void {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
  if (!range) {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': bytes.length
    })
    res.end(bytes)
    return
  }
  const from = Number(range[1])
  const to = range[2] ? Number(range[2]) : bytes.length - 1
  const slice = bytes.subarray(from, to + 1)
  res.writeHead(206, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': slice.length,
    'Content-Range': `bytes ${from}-${to}/${bytes.length}`
  })
  res.end(slice)
}

/** Start it on a port the operating system picks, so tests can run at once. */
export async function startFakeRomm(): Promise<FakeRomm> {
  const asked: Asked[] = []
  const held: { save: RommSave; content: string }[] = []
  const uploaded: FakeRomm['uploaded'] = []
  const megadrive = platform(1, 'genesis-slash-megadrive', 'Sega Mega Drive', 'genesis')
  const gameboy = platform(2, 'gb', 'Game Boy')
  // A Switch game because Eden is the emulator a launch can be tested with:
  // one system, one way to run it, and no core to fetch off the internet
  // first — which is what running a libretro game through RetroArch would do.
  const nintendoSwitch = platform(3, 'switch', 'Nintendo Switch')
  const segacd = platform(4, 'segacd', 'Sega CD')
  const slow = { ...rom(5, 'The Long Haul', megadrive, 'longhaul.md') }
  slow.fs_size_bytes = SLOW_ROM_BYTES.length
  slow.md5_hash = SLOW_ROM_MD5
  slow.files = [
    { ...slow.files[0], file_size_bytes: SLOW_ROM_BYTES.length, md5_hash: SLOW_ROM_MD5 }
  ]
  // Held for the Sega CD alone, so a test can tell a platform that needs
  // something from one that does not. The required file and one of the
  // optional ones — the third stays missing, which is what makes the screen's
  // count worth reading.
  const held_firmware = new Map<number, { item: RommFirmware; content: Buffer }[]>([
    [4, [firmware(70, 'bios_CD_U.bin'), firmware(71, 'bios_CD_E.bin')]]
  ])
  const roms = [
    rom(1, 'Cave Story MD', megadrive, 'cavestory.md'),
    rom(2, 'Tobu Tobu Girl', gameboy, 'tobutobugirl.gb'),
    rom(3, 'Test Chamber', nintendoSwitch, 'testchamber.nsp'),
    discSet(4, 'Disc Adventure', segacd, 'Disc Adventure'),
    slow
  ]

  /**
   * One shelf somebody made, holding games from two different platforms.
   *
   * Across platforms on purpose: it is the one grouping RomM has that RomMix
   * could not have worked out for itself, and a collection whose games all
   * shared a platform would be indistinguishable from the platform.
   */
  const collections: RommCollection[] = [
    {
      id: 10,
      name: 'Rainy Sunday',
      description: 'Short ones.',
      rom_ids: [1, 2],
      rom_count: 2,
      path_cover_small: null,
      path_cover_large: null,
      path_covers_small: [],
      path_covers_large: [],
      is_virtual: false,
      is_favorite: false
    }
  ]

  /**
   * The shelves RomM works out for itself, which are a different kind of thing.
   *
   * Two of them, and one deliberately empty: a collection with nothing on it is
   * one RomM keeps and the screen drops, so a list where every entry is stocked
   * cannot tell a working filter from a missing one.
   *
   * The id is a string here and a number on a collection somebody made, and it
   * goes to `/api/roms` under a different name — which is the whole reason the
   * two are separate types rather than one with a flag.
   */
  const virtualCollections: RommVirtualCollection[] = [
    {
      id: 'genre/platform',
      type: 'genre',
      name: 'Platform',
      description: 'Derived from what RomM knows about them.',
      rom_ids: [1, 3],
      rom_count: 2,
      path_cover_small: null,
      path_cover_large: null,
      path_covers_small: [],
      path_covers_large: [],
      is_virtual: true,
      is_favorite: false
    },
    {
      id: 'company/nobody',
      type: 'company',
      name: 'Nobody',
      description: 'Derived, and holding nothing.',
      rom_ids: [],
      rom_count: 0,
      path_cover_small: null,
      path_cover_large: null,
      path_covers_small: [],
      path_covers_large: [],
      is_virtual: true,
      is_favorite: false
    }
  ]

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const path = req.url ?? '/'
      const url = new URL(path, 'http://fake')
      asked.push({
        method: req.method ?? 'GET',
        path,
        authorization: req.headers.authorization ?? null,
        range: req.headers.range ?? null,
        body: Buffer.concat(chunks).toString()
      })

      const json = (body: unknown, status = 200): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      }

      // The one endpoint that answers before there are credentials: it is how
      // the connect screen decides whether an address is a RomM at all.
      if (url.pathname === '/api/heartbeat') return json({ SYSTEM: { VERSION: VERSION } })

      // Everything else is behind the token, so a harness that seeds
      // credentials wrongly fails here rather than three screens later with an
      // empty library and no explanation.
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        return json({ detail: 'Not authenticated' }, 401)
      }

      if (url.pathname === '/api/users/me') return json(user)
      if (url.pathname === '/api/platforms')
        return json([megadrive, gameboy, nintendoSwitch, segacd])
      if (url.pathname === '/api/collections') return json(collections)
      if (url.pathname === '/api/collections/virtual') return json(virtualCollections)
      if (url.pathname === '/api/devices') return json([] as RommDevice[])
      if (url.pathname === '/api/firmware') {
        const wanted = url.searchParams.get('platform_id')
        const all = [...held_firmware.values()].flat()
        const forPlatform = wanted ? (held_firmware.get(Number(wanted)) ?? []) : all
        return json(forPlatform.map((one) => one.item))
      }

      const firmwareContent = /^\/api\/firmware\/(\d+)\/content\//.exec(url.pathname)
      if (firmwareContent) {
        const found = [...held_firmware.values()]
          .flat()
          .find((one) => one.item.id === Number(firmwareContent[1]))
        if (!found) return json({ detail: 'No such firmware' }, 404)
        return serveBytes(req, res, found.content)
      }
      const saveContent = /^\/api\/saves\/(\d+)\/content$/.exec(url.pathname)
      if (saveContent) {
        const found = held.find((one) => one.save.id === Number(saveContent[1]))
        if (!found) return json({ detail: 'No such save' }, 404)
        return serveBytes(req, res, Buffer.from(found.content))
      }

      if (url.pathname === '/api/saves') {
        // Uploaded rather than listed. A session that wrote something ends with
        // a multipart POST here, and answering it is what lets the push be
        // asserted rather than merely not crashing.
        if (req.method === 'POST') {
          uploaded.push({
            romId: Number(url.searchParams.get('rom_id') ?? 0),
            emulator: url.searchParams.get('emulator'),
            deviceId: url.searchParams.get('device_id'),
            body: Buffer.concat(chunks).toString()
          })
          const saved: RommSave = {
            id: 900 + asked.length,
            rom_id: Number(url.searchParams.get('rom_id') ?? 0),
            user_id: user.id,
            file_name: 'uploaded',
            file_name_no_ext: 'uploaded',
            file_extension: '',
            file_size_bytes: 0,
            download_path: 'uploaded',
            emulator: url.searchParams.get('emulator'),
            slot: null,
            origin_device_id: url.searchParams.get('device_id'),
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z'
          }
          return json(saved)
        }
        const romId = Number(url.searchParams.get('rom_id') ?? 0)
        return json(held.filter((one) => one.save.rom_id === romId).map((one) => one.save))
      }
      if (url.pathname === '/api/states') return json([] as RommState[])

      if (url.pathname === '/api/roms') {
        const limit = Number(url.searchParams.get('limit') ?? 60)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const wanted = url.searchParams.getAll('platform_ids').map(Number)
        const shelf = url.searchParams.get('collection_id')
        const derived = url.searchParams.get('virtual_collection_id')
        const onShelf = shelf
          ? (collections.find((one) => one.id === Number(shelf))?.rom_ids ?? [])
          : derived
            ? (virtualCollections.find((one) => one.id === derived)?.rom_ids ?? [])
            : null
        const narrowed = onShelf
          ? roms.filter((one) => onShelf.includes(one.id))
          : wanted.length
            ? roms.filter((one) => wanted.includes(one.platform_id))
            : roms
        // Substring and case-insensitive, which is what RomM does with it and
        // what a screen typing a word at a time depends on. A ROM RomM has not
        // named matches nothing, rather than matching everything.
        const term = url.searchParams.get('search_term')?.toLowerCase()
        const matching = term
          ? narrowed.filter((one) => (one.name ?? '').toLowerCase().includes(term))
          : narrowed
        const page: RommRomPage = {
          items: matching.slice(offset, offset + limit),
          total: matching.length,
          limit,
          offset
        }
        return json(page)
      }

      const content = /^\/api\/roms\/(\d+)\/content\//.exec(url.pathname)
      if (content) {
        const found = roms.find((one) => one.id === Number(content[1]))
        if (!found) return json({ detail: 'No such ROM' }, 404)
        if (found.id !== 5) return serveBytes(req, res, ROM_BYTES)
        // The probe that asks whether this can be resumed wants one byte, not
        // two megabytes of it — and a transfer picking itself up says so with a
        // range too. Both are answered at once; only a fresh start is slow.
        if (req.headers.range) return serveBytes(req, res, SLOW_ROM_BYTES)
        return serveSlowly(res, SLOW_ROM_BYTES)
      }

      const fileContent = /^\/api\/roms\/(\d+)\/files\/content\/(.+)$/.exec(url.pathname)
      if (fileContent) {
        const wanted = Number(fileContent[1])
        const file = roms.flatMap((one) => one.files).find((one) => one.id === wanted)
        if (!file) return json({ detail: 'No such file' }, 404)
        // Its own bytes, keyed by the file's id rather than the game's — which
        // is what the per-file endpoint is, and what makes each file's hash
        // check mean something.
        return serveBytes(req, res, file.rom_id === 4 ? bytesFor(file.file_name) : ROM_BYTES)
      }

      const one = /^\/api\/roms\/(\d+)$/.exec(url.pathname)
      if (one) {
        const found = roms.find((entry) => entry.id === Number(one[1]))
        return found ? json(found) : json({ detail: 'No such ROM' }, 404)
      }

      // Written to, and answered without keeping anything: what these are here
      // for is that RomMix sends them at all, and with a body RomM would take.
      if (/^\/api\/roms\/\d+\/props$/.test(url.pathname)) return json({})
      if (url.pathname === '/api/play-sessions') return json({})

      return json({ detail: `the fake RomM has no ${url.pathname}` }, 404)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    asked,
    platforms: [megadrive, gameboy, nintendoSwitch, segacd],
    uploaded,
    holdSave: ({ romId, fileName, emulator, content }) => {
      held.push({
        content,
        save: {
          id: 500 + held.length,
          rom_id: romId,
          user_id: user.id,
          file_name: fileName,
          file_name_no_ext: fileName.replace(/\.[^.]+$/, ''),
          file_extension: fileName.split('.').pop() ?? '',
          file_size_bytes: Buffer.byteLength(content),
          download_path: fileName,
          emulator,
          slot: null,
          // Another device's, which is what makes it worth bringing down.
          origin_device_id: 'some-other-device',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: new Date().toISOString()
        }
      })
    },
    token: TOKEN,
    version: VERSION,
    roms,
    collections,
    virtualCollections,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve()))
      )
  }
}

/** What a downloaded game should hash to, for a test that checks the file. */
export const ROM_CONTENT = ROM_BYTES

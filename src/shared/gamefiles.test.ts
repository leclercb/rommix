import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  archiveIsTheRom,
  chooseLaunchFile,
  fileNameOf,
  folderOf,
  isLaunchable,
  newFilesOf
} from './gamefiles.ts'

const file = (name: string, sizeBytes = 1024): { name: string; sizeBytes: number } => ({
  name,
  sizeBytes
})

test('a lone ROM is the launch file', () => {
  assert.equal(
    chooseLaunchFile([file('QuackShot (World) (Rev A).md')]),
    'QuackShot (World) (Rev A).md'
  )
})

test('a cue wins over the much larger bin it references', () => {
  // The failure this prevents: the .bin is bigger by orders of magnitude, so a
  // plain "largest file" rule would pick a headerless track the emulator
  // cannot boot.
  const chosen = chooseLaunchFile([
    file('Final Fantasy VII (Disc 1).bin', 700_000_000),
    file('Final Fantasy VII (Disc 1).cue', 512)
  ])
  assert.equal(chosen, 'Final Fantasy VII (Disc 1).cue')
})

test('a multi-disc playlist wins over the per-disc descriptors', () => {
  const chosen = chooseLaunchFile([
    file('Final Fantasy VII (Disc 1).cue'),
    file('Final Fantasy VII (Disc 2).cue'),
    file('Final Fantasy VII.m3u')
  ])
  assert.equal(chosen, 'Final Fantasy VII.m3u')
})

test('a gdi is recognised for Dreamcast rips', () => {
  const chosen = chooseLaunchFile([
    file('track01.bin', 5_000_000),
    file('track02.raw', 900_000_000),
    file('game.gdi', 400)
  ])
  assert.equal(chosen, 'game.gdi')
})

test('sidecars never win, however large', () => {
  const chosen = chooseLaunchFile([
    file('Sonic.md', 1_048_576),
    file('scans.png', 90_000_000),
    file('readme.txt', 2_000)
  ])
  assert.equal(chosen, 'Sonic.md')
})

test('with no descriptor the largest remaining file is the game', () => {
  const chosen = chooseLaunchFile([
    file('manual.pdf', 5_000),
    file('Chrono Trigger (USA).sfc', 4_194_304)
  ])
  assert.equal(chosen, 'Chrono Trigger (USA).sfc')
})

test('an extensionless file is still a candidate', () => {
  // Some dumps ship the ROM with no extension at all; dropping it would leave
  // nothing to launch.
  assert.equal(chooseLaunchFile([file('DISC')]), 'DISC')
})

test('a dotfile is not mistaken for an extension', () => {
  assert.equal(chooseLaunchFile([file('.hidden', 10), file('game.md', 20)]), 'game.md')
})

test('nothing but sidecars resolves to null rather than a wrong guess', () => {
  assert.equal(chooseLaunchFile([file('readme.txt'), file('cover.jpg')]), null)
})

test('an empty directory resolves to null', () => {
  assert.equal(chooseLaunchFile([]), null)
})

test('a Switch game is the base container, not the playlist beside it', () => {
  // The failure this prevents: RomM ships a multi-file game with an .m3u, and
  // Eden has no loader for one — the launch fails with the game sitting right
  // there in the same folder.
  const chosen = chooseLaunchFile(
    [
      file('Metroid Dread [010093801237C000][v0].nsp', 7_000_000_000),
      file('Metroid Dread [010093801237C800][v393216].nsp', 900_000_000),
      file('Metroid Dread.m3u', 120)
    ],
    'switch'
  )
  assert.equal(chosen, 'Metroid Dread [010093801237C000][v0].nsp')
})

test('an update larger than the game it patches still loses', () => {
  // Size alone would pick the patch, and a patch on its own boots to nothing.
  const chosen = chooseLaunchFile(
    [
      file('Game [0100AAAAAAAAA000].xci', 1_000_000_000),
      file('Game [0100AAAAAAAAA800].nsp', 4_000_000_000)
    ],
    'switch'
  )
  assert.equal(chosen, 'Game [0100AAAAAAAAA000].xci')
})

test('DLC is not the game either', () => {
  const chosen = chooseLaunchFile(
    [
      file('Game [0100AAAAAAAAB001].nsp', 800_000_000),
      file('Game [0100AAAAAAAAA000].nsp', 500_000_000)
    ],
    'switch'
  )
  assert.equal(chosen, 'Game [0100AAAAAAAAA000].nsp')
})

test("another system's title id does not mark a Switch file as an add-on", () => {
  // Read as a Switch id it ends like an update's, and the smaller file beside it
  // would be launched in its place.
  const chosen = chooseLaunchFile(
    [file('Game [04007EF00011E800].nsp', 4_000_000_000), file('Game.nsp', 900_000_000)],
    'switch'
  )
  assert.equal(chosen, 'Game [04007EF00011E800].nsp')
})

test('a Switch dump named in words rather than title ids is still sorted out', () => {
  const chosen = chooseLaunchFile(
    [
      file('Some Game (Update).nsp', 3_000_000_000),
      file('Some Game [DLC].nsp', 400_000_000),
      file('Some Game.nsp', 2_000_000_000)
    ],
    'switch'
  )
  assert.equal(chosen, 'Some Game.nsp')
})

test('with every Switch container marked an add-on the largest is still launched', () => {
  // Rather than nothing: marks that disqualify everything are marks that were
  // misread, and a Play button that refuses to do anything is worse than one
  // that picks the likeliest file.
  const chosen = chooseLaunchFile(
    [
      file('Game [0100AAAAAAAAA800].nsp', 4_000_000_000),
      file('Game [0100AAAAAAAAB001].nsp', 900_000_000)
    ],
    'switch'
  )
  assert.equal(chosen, 'Game [0100AAAAAAAAA800].nsp')
})

test('a Switch game in no container format falls back to the general rule', () => {
  // Homebrew is a lone .nro, which is neither a container nor a descriptor.
  const chosen = chooseLaunchFile([file('readme.txt'), file('Homebrew.nro', 4_000_000)], 'switch')
  assert.equal(chosen, 'Homebrew.nro')
})

test('the playlist still wins where a playlist means something', () => {
  // The container rule is per system: nothing about the disc systems changes.
  const chosen = chooseLaunchFile(
    [file('Final Fantasy VII (Disc 1).cue'), file('Final Fantasy VII.m3u')],
    'psx'
  )
  assert.equal(chosen, 'Final Fantasy VII.m3u')
})

test('a playlist is not launchable on a container system', () => {
  // What sends an entry recorded before that rule back to disk for an answer.
  assert.equal(isLaunchable('Metroid Dread.m3u', 'switch'), false)
  assert.equal(isLaunchable('Metroid Dread.nsp', 'switch'), true)
  assert.equal(isLaunchable('Final Fantasy VII.m3u', 'psx'), true)
  assert.equal(isLaunchable('Sonic.md'), true)
})

test('a PS2 disc is the image, not the cue sheet naming it', () => {
  // PCSX2 reads a cue as a raw image and the game does not boot.
  const chosen = chooseLaunchFile(
    [
      file('Virtua Cop - Elite Edition (Europe).bin', 700_000_000),
      file('Virtua Cop - Elite Edition (Europe).cue', 512)
    ],
    'ps2'
  )
  assert.equal(chosen, 'Virtua Cop - Elite Edition (Europe).bin')
})

test('and a PS2 set of nothing but descriptors has nothing to launch', () => {
  assert.equal(chooseLaunchFile([file('Game.cue'), file('Game.m3u')], 'ps2'), null)
})

test('a descriptor is not launchable on PS2', () => {
  // What sends a game recorded with its cue back to disk for the image.
  assert.equal(isLaunchable('Virtua Cop.cue', 'ps2'), false)
  assert.equal(isLaunchable('Virtua Cop.m3u', 'ps2'), false)
  assert.equal(isLaunchable('Virtua Cop.bin', 'ps2'), true)
  assert.equal(isLaunchable('Virtua Cop.cue', 'psx'), true)
})

test('an arcade archive is the game rather than something to open', () => {
  // The failure this prevents: a romset unpacked into the chip dumps inside it,
  // which every arcade emulator refuses — the archive is what carries the name
  // of the set.
  assert.equal(archiveIsTheRom('arcade'), true)
  assert.equal(archiveIsTheRom('fbneo'), true)
})

test('an archive on any other system is transport and gets opened', () => {
  assert.equal(archiveIsTheRom('gba'), false)
  // A Neo Geo CD game is a disc image — ES-DE gives that system `.cue` and
  // `.chd` and no archive at all — whatever the Neo Geo beside it is.
  assert.equal(archiveIsTheRom('neogeocd'), false)
  // Triforce is Dolphin and a disc, however arcade the cabinet was.
  assert.equal(archiveIsTheRom('triforce'), false)
})

test('with no system named the archive is transport', () => {
  assert.equal(archiveIsTheRom(), false)
})

test('a path is reduced to the file at the end of it', () => {
  // What the renderer falls back to when RomM has no name for a game, where
  // `node:path` is not available to do it.
  assert.equal(
    fileNameOf('/home/deck/rommix/roms/gba/Advance Wars (Europe).gba'),
    'Advance Wars (Europe).gba'
  )
})

test('a name with no directory in front of it is already the answer', () => {
  assert.equal(fileNameOf('Sonic the Hedgehog (USA).md'), 'Sonic the Hedgehog (USA).md')
})

test('a game directory is named by its own last segment, not by what is in it', () => {
  // Multi-file games are recorded by the folder holding them, and that folder
  // is what the game is called.
  assert.equal(fileNameOf('/home/deck/rommix/roms/psx/Final Fantasy VII'), 'Final Fantasy VII')
})

test('a trailing slash leaves nothing to fall back to, rather than throwing', () => {
  assert.equal(fileNameOf('/home/deck/rommix/roms/psx/'), '')
})

test('a path is reduced to the directory holding it', () => {
  // What the screens name when they say where something is: the folder is what
  // a user can open, the file is what they already pressed.
  assert.equal(
    folderOf('/home/deck/rommix/roms/gba/Advance Wars (Europe).gba'),
    '/home/deck/rommix/roms/gba'
  )
})

test('a name with no directory in front of it has no folder to name', () => {
  assert.equal(folderOf('Sonic the Hedgehog (USA).md'), 'Sonic the Hedgehog (USA).md')
})

test('a file at the root is in the root', () => {
  assert.equal(folderOf('/rommix.AppImage'), '')
})

const onServer = (...names: string[]): { file_name: string }[] =>
  names.map((file_name) => ({ file_name }))

test('a file uploaded after the download is new', () => {
  assert.deepEqual(
    newFilesOf(onServer('Game.nsp', 'Game [UPD].nsp'), {
      path: '/roms/switch/Game',
      files: ['Game.nsp']
    }),
    onServer('Game [UPD].nsp')
  )
})

test('a copy holding every file has nothing new, whatever the case or the folder', () => {
  assert.deepEqual(
    newFilesOf(onServer('Game.CUE', 'Game.bin'), {
      path: '/roms/psx/Game',
      files: ['game.cue', 'wrapper/Game.bin']
    }),
    []
  )
})

test('a game RomM holds as one file has nothing new, whatever it unpacked to', () => {
  assert.deepEqual(
    newFilesOf(onServer('Game.zip'), { path: '/roms/snes/Game.sfc', files: ['Game.sfc'] }),
    []
  )
})

test('an entry listing no files is the file its path names', () => {
  assert.deepEqual(
    newFilesOf(onServer('Game.nsp', 'Game [DLC].nsp'), { path: '/roms/switch/Game.nsp' }),
    onServer('Game [DLC].nsp')
  )
})

test('an archive unpacked here stays unpacked when a file joins it', () => {
  assert.deepEqual(
    newFilesOf(onServer('Game.zip', 'Game [patch].ips'), {
      path: '/roms/snes/Game.sfc',
      files: ['Game.sfc']
    }),
    onServer('Game [patch].ips')
  )
})

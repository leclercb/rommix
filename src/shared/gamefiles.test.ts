import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseLaunchFile, isLaunchable } from './gamefiles.ts'

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

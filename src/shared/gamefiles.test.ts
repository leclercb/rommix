import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseLaunchFile } from './gamefiles.ts'

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

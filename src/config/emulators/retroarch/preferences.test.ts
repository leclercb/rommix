import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retroarch } from './index.ts'
import { coreForSystem } from '../../systems.ts'
import type { SaveContext, SaveEnvironment } from '../savepaths.ts'

const env: SaveEnvironment = {
  exists: () => false,
  dirs: () => [],
  files: () => [],
  text: () => null,
  head: () => null,
  read: () => null,
  inflateRaw: () => null,
  newest: () => 0
}
function context(): SaveContext {
  return {
    system: 'gba',
    romId: 7,
    romPath: '/roms/game.gba',
    romDir: '/roms',
    romStem: 'game',
    home: '/home/player',
    configDir: '/config',
    dataDir: null,
    installDir: null,
    env,
    paths: { home: null, roms: '/roms', saves: '/saves', states: '/states', bios: null },
    libretro: { systems: { gba: 'mgba' }, roms: { '7': 'gpsp' }, libraryNames: {} }
  }
}

test('game core overrides the platform consistently for launch, installation and save tags', () => {
  const ctx = context()
  const command = retroarch.launch({ ...ctx, exec: ['retroarch'], installRef: 'retroarch' })!
  assert.equal(command[command.indexOf('-L') + 1], 'gpsp_libretro.so')
  assert.equal(retroarch.core!(ctx)?.fileName, 'gpsp_libretro.so')
  assert.equal(retroarch.saves(ctx).emulator, 'gpsp')
  delete ctx.libretro!.roms['7']
  assert.equal(retroarch.core!(ctx)?.id, 'mgba')
  assert.equal(retroarch.saves(ctx).emulator, 'mgba')
  delete ctx.libretro
  assert.equal(retroarch.core!(ctx)?.id, coreForSystem('gba'))
})

test('invalid file paths cannot escape core installation through a preference', () => {
  const ctx = context()
  for (const name of ['../../bad', 'BAD', 'a/core', 'a\\core', '', 'core.so']) {
    ctx.libretro!.roms['7'] = name
    assert.equal(retroarch.core!(ctx)?.id, 'mgba')
  }
  ctx.libretro!.systems.gba = '../bad'
  assert.equal(retroarch.core!(ctx)?.id, coreForSystem('gba'))
})

test('configured library name controls both sorted folders without changing the tag', () => {
  const ctx = context()
  ctx.libretro!.libraryNames.gpsp = 'Installed Core Name'
  ctx.env = {
    ...env,
    text: () => 'sort_savefiles_enable = "true"\nsort_savestates_enable = "true"'
  }
  const paths = retroarch.saves(ctx)
  assert.equal(paths.saves?.dir, '/saves/Installed Core Name')
  assert.equal(paths.states?.dir, '/states/Installed Core Name')
  assert.equal(paths.emulator, 'gpsp')
  assert.ok(paths.alsoAccepts?.includes('Installed Core Name'))
  ctx.libretro!.libraryNames.gpsp = '../../outside'
  assert.ok(!retroarch.saves(ctx).saves?.dir.includes('outside'))
})

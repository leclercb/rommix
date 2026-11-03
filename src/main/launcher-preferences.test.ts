import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EmulatorState, RommRom } from '@shared/types'
import { Launcher } from './launcher.ts'
import type { Store } from './store.ts'
import type { RommClient } from './romm/index.ts'
import type { SaveSync } from './saves.ts'

test('launch routing passes the game identity and core preferences to the descriptor', () => {
  const libretro = { systems: { gba: 'mgba' }, roms: { '7': 'gpsp' }, libraryNames: {} }
  const store = { settings: { libretro } } as unknown as Store
  const launcher = new Launcher(store, {} as RommClient, {} as SaveSync)
  const command = launcher.buildCommand({
    rom: { id: 7 } as RommRom,
    system: 'gba',
    romPath: '/roms/game.gba',
    emulator: {
      id: 'retroarch',
      install: { kind: 'binary', ref: '/usr/bin/retroarch' }
    } as EmulatorState
  })!
  assert.equal(command[command.indexOf('-L') + 1], 'gpsp_libretro.so')
})

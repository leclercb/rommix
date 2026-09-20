import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emulatorById } from '@config/emulators'
import type { EmulatorState, ResolvedInstall } from '@config/emulators'
import type { RomMixApp } from './app.ts'
import { launcherKey, launchOptions } from './gamecontext.ts'

/**
 * The variant a launch runs, which is the one a save has to be filed under.
 *
 * `game:launch` and `saveContext` are written in different files and reach the
 * emulator by different routes, and both read `LaunchOptions.effective`. What
 * that field is worth is the whole of this: handed nothing, a descriptor falls
 * back to the head of its own table — the one row a machine may not have — so a
 * push goes looking for the session's save under an emulator that never ran,
 * finds nothing, and settles the unsent record as though there were nothing to
 * send. The save is on disk the whole time, under the emulator that wrote it.
 *
 * EmuDeck's Switch table is the case that makes it concrete: four emulators are
 * listed, most people have installed one, and the head of the table is not
 * usually theirs.
 */

const roots: string[] = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

/** A launchers directory holding exactly these scripts. */
function launchers(...scripts: string[]): ResolvedInstall {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-launch-variant-test-'))
  roots.push(dir)
  for (const script of scripts) writeFileSync(join(dir, script), '#!/bin/bash\n')
  return { kind: 'scripts', ref: dir }
}

/** EmuDeck as this machine has it, with `install` deciding what is offered. */
function emudeckWith(install: ResolvedInstall): EmulatorState {
  const descriptor = emulatorById('emudeck')!
  return { id: descriptor.id, name: descriptor.name, install } as EmulatorState
}

/** Only the part of the app `launchOptions` reads. */
function appRecording(systemLaunchers: Record<string, string>): RomMixApp {
  return { store: { settings: { systemLaunchers } } } as unknown as RomMixApp
}

test('with nothing recorded, the launch runs the first option this machine has', () => {
  // Not the first in the descriptor, which is Eden. Anything resolving the save
  // from the table rather than from here files it under an emulator that is not
  // installed.
  const emulator = emudeckWith(launchers('ryujinx.sh'))

  const { chosen, effective } = launchOptions(appRecording({}), emulator, 'switch')

  assert.equal(chosen, null)
  assert.equal(effective, 'ryujinx')
  assert.notEqual(effective, emulatorById('emudeck')!.variants?.('switch')[0]?.id)
})

test('a recorded choice is what runs, and so what the save is filed under', () => {
  const emulator = emudeckWith(launchers('citron.sh', 'ryujinx.sh'))
  const recorded = { [launcherKey('emudeck', 'switch')]: 'ryujinx' }

  const { chosen, effective } = launchOptions(appRecording(recorded), emulator, 'switch')

  assert.equal(chosen, 'ryujinx')
  assert.equal(effective, 'ryujinx')
})

test('a choice whose launcher has gone is asked again rather than substituted', () => {
  // The recorded emulator was uninstalled. `chosen` going null is what puts the
  // question back; `effective` still has to name something runnable, because
  // the save path is resolved from it whether or not anybody is asked.
  const emulator = emudeckWith(launchers('citron.sh'))
  const recorded = { [launcherKey('emudeck', 'switch')]: 'ryujinx' }

  const { chosen, effective, options } = launchOptions(appRecording(recorded), emulator, 'switch')

  assert.equal(chosen, null)
  assert.equal(effective, 'citron')
  assert.deepEqual(
    options.map((option) => option.id),
    ['citron']
  )
})

test('an emulator that claims the system with nothing installed for it says so', () => {
  // Distinct from an emulator with no variants at all, which is most of them.
  // `effective` is undefined here and the launch is refused by name rather than
  // exec'ing a script that is not there.
  const emulator = emudeckWith(launchers('dolphin-emu.sh'))

  const { effective, noLauncher } = launchOptions(appRecording({}), emulator, 'switch')

  assert.equal(effective, undefined)
  assert.equal(noLauncher, true)
})

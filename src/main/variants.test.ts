import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emulatorById } from '@config/emulators'
import type { ResolvedInstall } from '@config/emulators'
import { usableVariants } from './emulators.ts'

/**
 * Which ways of running a system survive being looked for.
 *
 * The table in EmuDeck's descriptor is a copy of what *its* installer sets up,
 * and the user chose which of those to install — four Switch emulators are
 * offered and most people have one. Believing the table produces a picker full
 * of options that exec a script that is not there, which on screen is a game
 * that does nothing at all. So the rule under test is that a launcher has to be
 * on disk before it is offered.
 */

const roots: string[] = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

/** A launchers directory holding exactly these scripts. */
function launchers(...scripts: string[]): ResolvedInstall {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-launchers-test-'))
  roots.push(dir)
  for (const script of scripts) writeFileSync(join(dir, script), '#!/bin/bash\n')
  return { kind: 'scripts', ref: dir }
}

const emudeck = emulatorById('emudeck')!
const eden = emulatorById('eden')!

const ids = (variants: readonly { id: string }[]): string[] => variants.map((v) => v.id)

test('only the launchers that are installed are offered', () => {
  // EmuDeck lists four Switch emulators; this user installed one of them.
  const install = launchers('citron.sh', 'retroarch.sh')
  assert.deepEqual(ids(usableVariants(emudeck, 'switch', install)), ['citron'])
})

test('the descriptor default is dropped when its script is absent', () => {
  // `switch` is headed by eden.sh in the table, so a machine without it would
  // otherwise launch into a path that does not exist.
  const install = launchers('ryujinx.sh')
  const offered = usableVariants(emudeck, 'switch', install)
  assert.deepEqual(ids(offered), ['ryujinx'])
  assert.equal(
    emudeck.variants?.('switch')[0]?.id,
    'eden',
    'the table still leads with eden; only the machine disagrees'
  )
})

test('a system whose launchers are all missing offers nothing', () => {
  assert.deepEqual(usableVariants(emudeck, 'switch', launchers('retroarch.sh')), [])
})

test('libretro entries ride on the one retroarch launcher', () => {
  const install = launchers('retroarch.sh')
  assert.deepEqual(ids(usableVariants(emudeck, 'saturn', install)), [
    'kronos',
    'mednafen_saturn',
    'yabause'
  ])
  // Same directory, but n3ds is standalone-only and none of its scripts are here.
  assert.deepEqual(usableVariants(emudeck, 'n3ds', install), [])
})

test('a system the descriptor does not cover is empty either way', () => {
  assert.deepEqual(usableVariants(emudeck, 'gamecube-not-a-system', launchers('retroarch.sh')), [])
})

test('an install that is one program is not searched for scripts', () => {
  // Nothing to check a file against, and nothing to check: an AppImage's
  // variants would be facts about the program, not about the folder it sits in.
  const appimage: ResolvedInstall = { kind: 'appimage', ref: '/nowhere/Eden.AppImage' }
  assert.deepEqual(usableVariants(eden, 'switch', appimage), [])
  assert.deepEqual(usableVariants(emudeck, 'switch', appimage), [
    ...(emudeck.variants?.('switch') ?? [])
  ])
})

test('an emulator that was not found keeps its declared options', () => {
  // `usableVariants` answers "what can run here"; whether the emulator is
  // installed at all is `probe`'s answer, and this one must not shadow it.
  assert.deepEqual(ids(usableVariants(emudeck, 'switch', null)), [
    'eden',
    'citron',
    'ryujinx',
    'yuzu'
  ])
})

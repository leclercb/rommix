import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RommRom } from '@shared/types'
import { installName, listDir } from './install.ts'
import { expandShell } from './emulators.ts'
import { builtForThisMachine } from './releases.ts'
import { normaliseBaseUrl } from './romm.ts'

/**
 * Deciding what a thing is called and where it goes.
 *
 * Four small functions from four modules, together here because they answer one
 * question — what path does this become — and because getting any of them wrong
 * is silent. A ROM installed under the wrong name is invisible to the emulator's
 * own scanner; a settings value left unexpanded becomes a folder named after a
 * shell variable; an asset for the wrong architecture installs and then refuses
 * to start; a base URL assembled wrongly makes every request 404.
 */

const roots: string[] = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-paths-test-'))
  roots.push(dir)
  return dir
}

/** Only the fields `installName` reads. */
function rom(fields: Partial<RommRom>): RommRom {
  return { fs_name: '', fs_name_no_ext: '', fs_extension: '', files: [], ...fields } as RommRom
}

function file(name: string): RommRom['files'][number] {
  return { file_name: name } as RommRom['files'][number]
}

// -- installName ------------------------------------------------------------

test('an ordinary ROM keeps the name the server gives it', () => {
  assert.equal(
    installName(rom({ fs_name: 'Sonic.md', fs_extension: 'md', fs_name_no_ext: 'Sonic' })),
    'Sonic.md'
  )
})

test('a ROM the server holds as a folder takes the name of the file inside', () => {
  // RomM reports the *folder* as `fs_name` with no extension. Installed under
  // that name the game is playable from RomMix and invisible to the emulator's
  // own scanner, which matches on extension — the most confusing state RomMix
  // can leave behind.
  assert.equal(
    installName(rom({ fs_name: 'F-ZERO 99', fs_extension: '', files: [file('F-ZERO 99.nsp')] })),
    'F-ZERO 99.nsp'
  )
})

test('a genuine multi-file game keeps the folder name', () => {
  // More than one file means a directory install, and the directory is named
  // after the game rather than after any one of its parts.
  assert.equal(
    installName(
      rom({
        fs_name: 'Final Fantasy VII',
        fs_extension: '',
        files: [file('disc1.bin'), file('disc1.cue')]
      })
    ),
    'Final Fantasy VII'
  )
})

// -- listDir ----------------------------------------------------------------

test('a folder is indexed by exact name and by stem', async () => {
  const dir = scratch()
  writeFileSync(join(dir, 'Sonic.md'), '')
  const listing = await listDir(dir)
  assert.equal(listing.byName.get('sonic.md')?.name, 'Sonic.md')
  assert.equal(listing.byStem.get('sonic')?.name, 'Sonic.md')
})

test('a directory keeps its whole name as its stem', async () => {
  // Games really are punctuated like this, and `Final Fantasy VII (Disc 1.1)`
  // is not a folder called `Final Fantasy VII (Disc 1`.
  const dir = scratch()
  mkdirSync(join(dir, 'Final Fantasy VII (Disc 1.1)'))
  const listing = await listDir(dir)
  assert.equal(
    listing.byStem.get('final fantasy vii (disc 1.1)')?.name,
    'Final Fantasy VII (Disc 1.1)'
  )
})

test('a directory beats a file of the same stem', async () => {
  // A multi-file game and a stray loose file can share a stem; the directory is
  // the one holding the game.
  const dir = scratch()
  writeFileSync(join(dir, 'Game.bin'), '')
  mkdirSync(join(dir, 'Game'))
  const listing = await listDir(dir)
  assert.equal(listing.byStem.get('game')?.isDirectory(), true)
})

test('a missing folder lists as empty rather than throwing', async () => {
  const listing = await listDir('/nonexistent/rommix/roms')
  assert.equal(listing.byName.size, 0)
  assert.equal(listing.byStem.size, 0)
})

// -- expandShell ------------------------------------------------------------

test('a settings value referring to another is resolved', () => {
  // EmuDeck writes exactly this, and handling only `$HOME` left it as a folder
  // literally named `$emulationPath`.
  const known = new Map([['emulationPath', '/run/media/sd/Emulation']])
  assert.equal(expandShell('$emulationPath/roms', known), '/run/media/sd/Emulation/roms')
  assert.equal(expandShell('${emulationPath}/bios', known), '/run/media/sd/Emulation/bios')
})

test('$HOME and a leading tilde both expand', () => {
  const home = process.env.HOME ?? ''
  assert.equal(expandShell('$HOME/Emulation', new Map()), `${home}/Emulation`)
  assert.equal(expandShell('${HOME}/Emulation', new Map()), `${home}/Emulation`)
  assert.equal(expandShell('~/Emulation', new Map()), `${home}/Emulation`)
})

test('a tilde inside a path is left alone', () => {
  // Only the shell's own rule: `~` is a home reference at the front and a
  // character everywhere else.
  assert.equal(expandShell('/games/back~up', new Map()), '/games/back~up')
})

test('an unresolvable reference makes the whole value null', () => {
  // Dropped rather than used: a ROM folder called `$nope` is worse than none,
  // because the missing one is reported and the named one is silently created.
  assert.equal(expandShell('$nope/roms', new Map()), null)
})

test('a plain absolute path passes through untouched', () => {
  assert.equal(expandShell('/home/deck/Emulation', new Map()), '/home/deck/Emulation')
})

// -- builtForThisMachine ----------------------------------------------------

test('a build for another architecture is refused', () => {
  const other = process.arch === 'arm64' ? 'amd64' : 'aarch64'
  assert.equal(builtForThisMachine(`Eden-Linux-v0.2.1-${other}-gcc-standard.AppImage`), false)
})

test('a build for this architecture is accepted', () => {
  const mine = process.arch === 'arm64' ? 'aarch64' : 'amd64'
  assert.equal(builtForThisMachine(`Eden-Linux-v0.2.1-${mine}-gcc-standard.AppImage`), true)
})

test('an asset naming no architecture is accepted', () => {
  // shadPS4's Linux zip carries none, because only one is published — a rule
  // demanding a positive match would leave that picker empty.
  assert.equal(builtForThisMachine('shadps4-linux-sdl-2026-08-23-7fb1a53.zip'), true)
})

// -- normaliseBaseUrl -------------------------------------------------------

test('a bare host is given a scheme', () => {
  assert.equal(normaliseBaseUrl('romm.example.org'), 'https://romm.example.org')
})

test('a trailing slash is dropped so paths can be concatenated', () => {
  assert.equal(normaliseBaseUrl('https://romm.example.org/'), 'https://romm.example.org')
})

test('a pasted /api is dropped, since RomMix adds it back', () => {
  assert.equal(normaliseBaseUrl('https://romm.example.org/api'), 'https://romm.example.org')
})

test('a subpath the server is actually hosted under is kept', () => {
  assert.equal(normaliseBaseUrl('https://example.org/romm/'), 'https://example.org/romm')
})

test('plain http is left as it was typed', () => {
  // A local server on a home network is the ordinary case, and silently
  // upgrading it to https would make it unreachable.
  assert.equal(normaliseBaseUrl('http://192.168.1.10:8080'), 'http://192.168.1.10:8080')
})

test('an empty address is refused rather than becoming https://', () => {
  assert.throws(() => normaliseBaseUrl('   '))
})

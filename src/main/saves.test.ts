import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acceptsTag,
  localTag,
  primarySave,
  sameFormat,
  stemMatches,
  syncStateOf
} from './savefiles.ts'

/**
 * The three judgements save sync makes that nothing else checks.
 *
 * `stemMatches` decides whether a file on disk belongs to this game. Too strict
 * and a real save is never uploaded; too loose and one game's memory card is
 * attributed to another, which is the worse of the two by a distance — RomM
 * would then hand it back under the wrong id on another device.
 *
 * `syncStateOf` decides which end is ahead, and therefore which badge the detail
 * screen shows and whether a pull would overwrite something. Its awkward case is
 * that a server copy is *always* stamped later than the local file it came from,
 * because `updated_at` is the upload time — so "newer on the server" cannot mean
 * "changed elsewhere" without knowing where it came from.
 *
 * `primarySave` decides which of a game's files goes up under the slot every
 * other client reads. Wrong, and the save syncs against another client's copy
 * of something else — or against nothing, which is where every RomMix save sat
 * before there was a slot at all.
 *
 * `localTag` and `acceptsTag` decide whose saves this device will take. They are
 * tested as a pair because the bug they replaced was not in either rule but in
 * the gap between them: the push named the emulator underneath a frontend and
 * the pull compared against the frontend's own id, so the two could not agree
 * and the difference was papered over by accepting every tag.
 */

test('an exact stem matches', () => {
  assert.equal(stemMatches('Sonic The Hedgehog', 'Sonic The Hedgehog'), true)
})

test('punctuation and case are ignored, as emulators vary on both', () => {
  assert.equal(stemMatches('sonic_the_hedgehog', 'Sonic The Hedgehog'), true)
  assert.equal(stemMatches('Sonic-The-Hedgehog', 'Sonic The Hedgehog'), true)
})

test('the slot number on a memory card still matches', () => {
  // DuckStation writes `Suikoden II_1.mcd`; the ROM is `Suikoden II`. Mednafen
  // writes the same card as `Suikoden II.1.mcr`.
  assert.equal(stemMatches('Suikoden II_1', 'Suikoden II', '.mcd'), true)
  assert.equal(stemMatches('Suikoden II.1', 'Suikoden II', '.mcr'), true)
})

test('a name that writes its spaces the way a slot is written keeps the number', () => {
  // On a card the number is ambiguous: the separator that would make it a slot
  // is the one this library uses between words, so the sequel reading is the
  // one that cannot upload a save under another game's id.
  assert.equal(stemMatches('Sonic_Advance_2', 'Sonic Advance', '.mcd'), false)
  assert.equal(stemMatches('Sonic.Advance.2', 'Sonic Advance', '.mcr'), false)
  // Nothing else in the name uses it, so this one is a slot.
  assert.equal(stemMatches('Sonic Advance_2', 'Sonic Advance', '.mcd'), true)
  // And where the name is one word there is nothing to read the convention
  // from: the card of a sequel to a single-word title is taken for slot two of
  // the title. Nothing in a file name settles that, and the reading that keeps
  // a card working is the one kept.
  assert.equal(stemMatches('Suikoden_2', 'Suikoden', '.mcd'), true)
})

test('a slot number is only a slot number on a card', () => {
  // `_` is a slot separator on a memory card and a word separator everywhere
  // else, and a library named with underscores is full of the second. Only the
  // extension tells them apart, so a battery save is never read as a slot.
  assert.equal(stemMatches('Sonic_Advance_2', 'Sonic Advance', '.srm'), false)
  assert.equal(stemMatches('Sonic_Advance_2', 'Sonic_Advance', '.srm'), false)
  assert.equal(stemMatches('Sonic_Advance_2', 'Sonic Advance'), false)
})

test('a region tag on the ROM but not on the save still matches', () => {
  // RomM exposes the game as `Final Fantasy VII (USA)`, and the card written for
  // it carries none of that. This is what the looser second key exists for.
  assert.equal(stemMatches('Final Fantasy VII_1', 'Final Fantasy VII (USA)', '.mcd'), true)
  assert.equal(stemMatches('Final Fantasy VII', 'Final Fantasy VII (USA) [!]'), true)
})

test('a different game does not match', () => {
  assert.equal(stemMatches('Sonic 2', 'Streets of Rage'), false)
  assert.equal(stemMatches('Suikoden', 'Wild Arms'), false)
})

test('a longer title this one only opens is a different game', () => {
  // One folder of `.srm` files holds the whole shelf, so a game whose name is
  // where another's begins is the ordinary case rather than the odd one, and
  // the cost of getting it wrong is a save uploaded under the wrong game's id.
  assert.equal(stemMatches('Castlevania - Symphony of the Night (USA)', 'Castlevania (USA)'), false)
  assert.equal(stemMatches('Castlevania (USA)', 'Castlevania - Symphony of the Night (USA)'), false)
})

test('a sequel is not the game it follows', () => {
  // The same rule where the difference is a number, which is the shape a slot
  // also has. A card is the only file that carries one.
  assert.equal(stemMatches('Sonic Advance 2', 'Sonic Advance', '.srm'), false)
  assert.equal(stemMatches('Sonic Advance', 'Sonic Advance 2', '.srm'), false)
  assert.equal(stemMatches('Sonic Advance 2', 'Sonic Advance', '.mcd'), false)
})

test('a name that loosens to nothing matches nothing', () => {
  // `(USA)` reduces to an empty key, and an empty key is a prefix of every
  // string — which for a folder of memory cards means uploading the wrong one.
  assert.equal(stemMatches('(USA)', 'Final Fantasy VII'), false)
  assert.equal(stemMatches('Final Fantasy VII', '(USA)'), false)
  assert.equal(stemMatches('', 'Sonic'), false)
})

test('a save only this device has is local-only', () => {
  assert.equal(syncStateOf(null, '2026-01-01T00:00:00Z', null), 'remote-only')
})

test('a local file written after the upload is local-newer', () => {
  const remote = '2026-01-01T00:00:00Z'
  assert.equal(syncStateOf(Date.parse(remote) + 60_000, remote, true), 'local-newer')
})

test('a server copy this device uploaded is in sync, not newer', () => {
  // The upload stamps `updated_at` later than the file's own mtime, every time.
  // Without the origin check this row would always read `remote-newer` and
  // invite a pull that overwrites the file with itself.
  const local = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(syncStateOf(local, '2026-01-01T00:05:00Z', true), 'synced')
})

test('a server copy from another device is remote-newer', () => {
  const local = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(syncStateOf(local, '2026-01-01T00:05:00Z', false), 'remote-newer')
})

test('a server copy with no recorded origin is treated as remote-newer', () => {
  // Every state, and anything uploaded through RomM's web UI. The honest answer
  // with what the server says, and the same thing a pull would do with it.
  const local = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(syncStateOf(local, '2026-01-01T00:05:00Z', null), 'remote-newer')
})

test('identical timestamps are in sync', () => {
  const at = '2026-01-01T00:00:00Z'
  assert.equal(syncStateOf(Date.parse(at), at, null), 'synced')
})

test('a file just pulled is in sync, not newer here', () => {
  // The pull stamps what it writes with the server's `updated_at`, and a card
  // formatted FAT32 rounds that to the nearest two seconds. Both directions of
  // that rounding are the same file, and neither is a reason to offer a push.
  const at = '2026-01-01T00:00:00Z'
  assert.equal(syncStateOf(Date.parse(at) + 1000, at, null), 'synced')
  assert.equal(syncStateOf(Date.parse(at) - 1000, at, null), 'synced')
})

test('a local file past the rounding tolerance is still local-newer', () => {
  // The tolerance absorbs a filesystem's timestamp granularity, nothing more:
  // a session played after the pull must still read as a push candidate.
  const at = '2026-01-01T00:00:00Z'
  assert.equal(syncStateOf(Date.parse(at) + 3000, at, null), 'local-newer')
})

test('an unparseable server timestamp does not invent a conflict', () => {
  assert.equal(syncStateOf(Date.now(), 'not a date', null), 'synced')
})

/** A descriptor that named no emulator: a standalone, tagged with its own id. */
const standalone = { saves: null, states: null }

test('a standalone is tagged with its own id', () => {
  assert.equal(localTag(standalone, 'retroarch'), 'retroarch')
  assert.equal(localTag(standalone, 'eden'), 'eden')
})

test('a frontend is tagged with the emulator underneath, not with itself', () => {
  // The whole reason the two sides have to share this function: RetroDECK's id
  // is 'retrodeck' and it never appears on a save it writes.
  assert.equal(localTag({ ...standalone, emulator: 'pcsx2' }, 'retrodeck'), 'pcsx2')
  assert.equal(localTag({ ...standalone, emulator: 'retroarch' }, 'retrodeck'), 'retroarch')
})

test('a save from this emulator is accepted', () => {
  assert.equal(acceptsTag('eden', 'eden'), true)
})

test('the same emulator reached three ways is one tag', () => {
  // Standalone PCSX2, RetroDECK's PCSX2 and EmuDeck's all upload 'pcsx2', which
  // is what makes a memory card written on one readable on the others.
  const tag = localTag({ ...standalone, emulator: 'pcsx2' }, 'retrodeck')
  assert.equal(acceptsTag(tag, localTag({ ...standalone, emulator: 'pcsx2' }, 'emudeck')), true)
  assert.equal(acceptsTag(tag, localTag(standalone, 'pcsx2')), true)
})

test('case does not decide it, because the frontends disagree on it', () => {
  // EmuDeck's folders are `Cemu` and `Vita3K`; RetroDECK's components are
  // lowercase. Both are the same program.
  assert.equal(acceptsTag('cemu', 'Cemu'), true)
  assert.equal(acceptsTag('Vita3K', 'vita3k'), true)
})

test('a save from another emulator is refused', () => {
  assert.equal(acceptsTag('eden', 'retroarch'), false)
  assert.equal(acceptsTag('retroarch', 'shadps4'), false)
})

test('two frontends running different emulators do not swap saves', () => {
  // The case the old rule got wrong: RetroDECK dispatching Saturn to Yabause
  // and EmuDeck dispatching it to a libretro core are not interchangeable, and
  // both being frontends was taken as reason enough to trade files.
  const emudeck = localTag({ ...standalone, emulator: 'retroarch' }, 'emudeck')
  assert.equal(acceptsTag(emudeck, 'yabause'), false)
})

test('a frontend takes back the save it wrote itself', () => {
  // And the case the old rule was compensating for: comparing against the
  // descriptor id, 'pcsx2' never equals 'retrodeck'.
  const tag = localTag({ ...standalone, emulator: 'pcsx2' }, 'retrodeck')
  assert.equal(acceptsTag(tag, 'pcsx2'), true)
})

test('a libretro save uploaded before the core became the tag is still taken', () => {
  // MIGRATION(0.12): every libretro save already on a server says `retroarch`,
  // which no longer matches the core this device now uploads under. Without the
  // second list they are all silently skipped on the first launch after the
  // update — a year of saves, still on the server, that RomMix has quietly
  // stopped recognising.
  assert.equal(acceptsTag('mupen64plus_next', 'retroarch'), false)
  assert.equal(acceptsTag('mupen64plus_next', 'retroarch', ['retroarch']), true)
})

test('the older tag opens nothing else', () => {
  // It is one name being forgiven, not a rule that a frontend's saves are
  // everyone's: a Yabause save is still refused whatever is being carried.
  assert.equal(acceptsTag('mupen64plus_next', 'yabause', ['retroarch']), false)
  assert.equal(acceptsTag('mupen64plus_next', 'snes9x', ['retroarch']), false)
})

test('an untagged asset is refused, silence being no match', () => {
  // Only states and directory saves are asked about here, and for those a
  // positive match is the whole point: loading another core's snapshot is not
  // a file being ignored. A battery save never asks — an untagged one is taken
  // without consulting this at all, which is where the tag decides nothing.
  assert.equal(acceptsTag('retroarch', null), false)
  assert.equal(acceptsTag('retroarch', ''), false)
})

test('a tag naming another emulator is still refused', () => {
  // The distinction the untagged case turns on: no tag is the absence of a
  // claim, and a tag is a claim that this was written by something else.
  assert.equal(acceptsTag('mupen64plus_next', 'parallel_n64'), false)
})

test('the only save a game has is the one that holds the slot', () => {
  // Whatever it is called: the name is what this emulator opens, and the slot
  // is how the other end finds it whatever it calls its own copy.
  assert.equal(primarySave(['sonic.srm'], 'Sonic The Hedgehog'), 'sonic.srm')
  assert.equal(
    primarySave(['Zelda.rommix-save.zip'], 'Zelda'),
    'Zelda.rommix-save.zip',
    'a folder save is the game\u2019s save, and one asset'
  )
})

test('a memory card never holds the slot, alone or beside anything', () => {
  // The number is part of the name DuckStation opens and mednafen writes it
  // differently, so it cannot be read off a copy another client uploaded — a
  // card pulled from a slot would land under a name nothing opens. Cards keep
  // being matched on their names.
  assert.equal(primarySave(['Suikoden II_1.mcd'], 'Suikoden II'), null)
  assert.equal(primarySave(['Suikoden II.1.mcr'], 'Suikoden II'), null)
  // And a battery save beside one is picked without the card confusing it.
  assert.equal(
    primarySave(['Suikoden II_1.mcd', 'Suikoden II.srm'], 'Suikoden II'),
    'Suikoden II.srm'
  )
})

test('a game with nothing on disk holds no slot', () => {
  assert.equal(primarySave([], 'Sonic The Hedgehog'), null)
})

test("the game's own name separates the save from what sits beside it", () => {
  // The clock file is real save data and still goes up — under its own name,
  // with no slot. What it cannot be is the copy another device pairs against.
  assert.equal(
    primarySave(['Pokemon Crystal.srm', 'Pokemon Crystal.rtc'], 'Pokemon Crystal'),
    'Pokemon Crystal.srm'
  )
})

test('two cards for one game leave the slot unclaimed', () => {
  assert.equal(primarySave(['Suikoden II_1.mcd', 'Suikoden II_2.mcd'], 'Suikoden II'), null)
})

test('the answer does not depend on the order the directory was read in', () => {
  // Two devices that disagree about the slot pair a save with the wrong copy,
  // so the same set has to give the same answer whichever way round it arrives.
  const files = ['Pokemon Crystal.rtc', 'Pokemon Crystal.srm']
  assert.equal(primarySave(files, 'Pokemon Crystal'), 'Pokemon Crystal.srm')
  assert.equal(primarySave(files.toReversed(), 'Pokemon Crystal'), 'Pokemon Crystal.srm')
})

test('a slot pairs two files only where they are the same kind of file', () => {
  // The names differ by design under a slot, so nothing else stands between the
  // copy in it and a local file of another format. A save folder holds more
  // than one kind — the battery save, and the clock file that dates it.
  assert.equal(sameFormat('Pokemon Crystal.srm', 'Pokemon Crystal [2026-09-08_22-30-05].srm'), true)
  assert.equal(sameFormat('Pokemon Crystal.rtc', 'Pokemon Crystal.srm'), false)
  // Case is the emulators' to vary, not a difference in format.
  assert.equal(sameFormat('sonic.SRM', 'sonic.srm'), true)
})

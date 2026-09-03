/**
 * The server RomMix is signed in to, and everything the user has chosen.
 *
 * All of it is written to disk by `Store` and handed to the renderer whole, so
 * a field added here is a field the settings screen can read without a channel
 * of its own.
 */

import type { DateFormat } from '../i18n/dates.ts'
import type { LanguageChoice } from '../i18n/locales.ts'
import type { EmulatorId } from '../../config/emulators/types.ts'
import type { RommUser } from './romm.ts'
import type { UpdatePolicy } from './updates.ts'

export type AuthMode = 'password' | 'device' | 'token'

export interface ServerConfig {
  /** Base URL with no trailing slash, e.g. https://romm.example.org */
  baseUrl: string
  authMode: AuthMode
  username?: string
}

export interface ConnectionStatus {
  connected: boolean
  /**
   * A server is stored and so are credentials for it, whatever it answered.
   *
   * What separates a fresh installation from one that has simply lost its
   * server: the first has nowhere to go but the sign-in screen, the second has
   * a disk full of games and no reason to be asked to sign in again.
   */
  configured: boolean
  /**
   * Signed in as far as this device knows, and nothing answered.
   *
   * The state the rest of the interface changes shape for — see the games
   * screen. Deliberately not simply `!connected`: credentials RomM refuses are
   * an answer, and the only thing that fixes them is the sign-in screen, so a
   * refusal is never offline however unreachable it feels.
   */
  offline: boolean
  baseUrl: string | null
  user: RommUser | null
  /** RomM version reported by /api/heartbeat, when available. */
  serverVersion: string | null
  error: string | null
}

/**
 * Where downloaded games are written.
 *
 * `emulator` puts each game in the ROM folder of whichever emulator runs its
 * platform. That is what makes a download visible in the emulator's own game
 * list when it is started outside RomMix, and it is why a platform pointed at a
 * different emulator stops counting as downloaded — the file is still there,
 * in a tree the new emulator never reads.
 *
 * `rommix` puts everything in one tree inside RomMix's folder, which the user
 * adds to each emulator's game directories once. It costs that setup step and
 * buys two things back: changing which emulator runs a platform moves nothing
 * and re-downloads nothing, and a game can be fetched for a platform that has
 * no emulator installed at all — a Switch library is worth having on disk
 * before Eden is.
 *
 * `rommix` is the default. The setup step is a one-off that the pre-flight
 * check spells out; the re-download `emulator` costs is paid every time somebody
 * changes their mind about which emulator runs a platform, which is a thing
 * Settings actively invites.
 */
export type RomStorage = 'emulator' | 'rommix'

export interface Settings {
  /**
   * ES-DE system -> emulator id: which emulator runs each platform.
   *
   * Only systems the user has actually chosen for are stored; anything absent
   * uses `defaultEmulatorFor()`. A recorded choice is honoured strictly — an
   * emulator that is not installed is reported rather than silently swapped.
   */
  systemEmulators: Record<string, EmulatorId>
  /**
   * Emulator id -> absolute path of its executable, when auto-discovery cannot
   * find it. AppImages in particular live wherever the user put them.
   */
  emulatorPaths: Record<EmulatorId, string>
  /**
   * Emulator id -> the folder holding that emulator's library, when the user
   * has moved it somewhere RomMix does not find on its own.
   *
   * One root rather than four paths: RetroDECK and EmuDeck each keep roms,
   * saves, states and BIOS in one relocatable tree, and the reason to set this
   * — the library lives on an SD card or a second drive — moves all of them at
   * once. The names below it come from the descriptor's `layout.relative`.
   */
  emulatorRoots: Record<EmulatorId, string>
  /**
   * `<emulator id>:<es-de system>` -> launch variant id.
   *
   * For emulators that offer more than one way to run a system — EmuDeck's
   * three Saturn cores, its four Switch emulators. Recorded the first time the
   * user is asked, so the question is not repeated before every game.
   */
  systemLaunchers: Record<string, string>
  /** RomM platform slug -> ES-DE system folder name. Overrides the built-in map. */
  systemOverrides: Record<string, string>
  /**
   * Emulator ids, most preferred first.
   *
   * The order decides which emulator runs a platform when that platform has no
   * choice of its own: the first one in this list that is installed and covers
   * it. Empty means the registry's own order, and any emulator missing from the
   * list keeps its registry position behind those named here — so a list
   * written before an emulator existed does not hide it.
   */
  emulatorPriority: EmulatorId[]
  /** Where downloaded games are written. See `RomStorage`. */
  romStorage: RomStorage
  /**
   * True once the first-run wizard has been completed.
   *
   * Separate from "is there a server configured", which is what the connect
   * screen used to infer this from. Signing out clears the server and would
   * otherwise put someone who has been using RomMix for months back through a
   * page asking how big they would like the text — the wizard is about choices
   * made once, not about being disconnected.
   */
  setupComplete: boolean
  /** Pull newer saves down from RomM before launching. */
  syncSavesDown: boolean
  /** Push saves/states back to RomM after the game exits. */
  syncSavesUp: boolean
  /**
   * A quiet click as focus moves, and when something is chosen or left.
   *
   * On by default: RomMix is driven from a sofa, where the highlight is often
   * on the far side of the screen from what is being looked at, and the click
   * is what says a press landed. Off is for a room where it would be heard by
   * somebody who is not playing. See `playCue`.
   */
  navigationSounds: boolean
  /** Ask for confirmation before deleting a downloaded game. */
  confirmUninstall: boolean
  /**
   * Ask before anything is sent to RomM — both the Push saves button and the
   * automatic upload when a game exits.
   *
   * On by default, not because pushing is destructive — RomM keeps every
   * version — but because this dialog is the only place RomMix says what it is
   * about to put on the server under this game's id. Where the saves came from
   * was resolved per emulator, partly by heuristic, and a wrong answer is worth
   * catching here rather than on another device that pulls it down. It costs
   * one press, and that press can be `Send and don't ask again`.
   *
   * The two pushes ask the same question from different sides. The button knows
   * its answer before it does anything; the automatic one has already run, so
   * the launch hands its file list back as `LaunchResult.pendingPush` and
   * uploads nothing until the renderer sends the approved paths to
   * `saves:pushSelected`. Declining costs nothing either way — the files stay
   * where the emulator wrote them, and the button sends everything on disk.
   */
  confirmSavePush: boolean
  /**
   * Notices the user has said they do not want again, by key.
   *
   * Kept as a list of opaque keys rather than a flag per notice so that adding
   * one later needs no migration: an unknown key simply means "not dismissed".
   */
  dismissedNotices: string[]
  /**
   * How much larger than its drawn size the interface is rendered, or 0 for
   * "match the screen".
   *
   * The stylesheet is written in CSS pixels for a 1080p television, so on a 4K
   * one — which hands Chromium 3840x2160 CSS pixels rather than scaling
   * anything itself — every size in it comes out half as large as it was drawn
   * to be. 0 measures the screen and picks the factor; a number states it,
   * for a panel whose reported size does not match how far away it is sat from.
   */
  uiScale: number
  /**
   * Which language the interface is drawn in, or `auto` to follow the desktop.
   *
   * One setting for both processes: the main process translates its own
   * messages — a failed launch, a BIOS that cannot be placed — before they
   * cross IPC, so an error and the screen it lands on are never in two
   * different languages. See `LanguageChoice`.
   */
  language: LanguageChoice
  /**
   * How every date and time RomMix shows is written. See `DATE_FORMATS`.
   *
   * Separate from `language`, because the two answer different questions: one
   * is what RomMix speaks, the other is what a date is expected to look like,
   * and plenty of people read an interface in one language and dates in the
   * order another writes them.
   */
  dateFormat: DateFormat
  /**
   * What RomMix does about a new version of itself. See `UpdatePolicy`.
   *
   * `auto` by default. RomMix ships as an AppImage, which nothing on the
   * machine updates for you: without this, a copy downloaded once stays at that
   * version until its owner happens to look at the releases page again.
   */
  updates: UpdatePolicy
  /**
   * Whether a release published for testing counts as a new version.
   *
   * Off. A candidate is tagged with a suffix — `0.9.0-rc.1` — and marked as a
   * pre-release on GitHub, which is what keeps it out of the release the
   * updater asks for by default; turning this on is how somebody volunteers to
   * run one. See `Updater.check`.
   */
  updatePrereleases: boolean
  /** Stable identifier reported to RomM as this device. */
  deviceId: string
  deviceName: string
}

import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { chooseLaunchFile, isLaunchable, type GameFile } from '@shared/gamefiles'
import { emulatorById, emulatorsForSystem } from '@config/emulators'
import { resolveSystem } from '@config/systems'
import { SHARED_LIBRARY } from '@shared/types'
import type { EmulatorState, InstalledRom, LibrarySyncResult, RommRom } from '@shared/types'
import {
  directorySize,
  installName,
  listDir,
  pickLaunchFile,
  type DirListing,
  type InstallResult
} from './install.ts'
import { log } from './log.ts'
import { RommClient, RommError } from './romm.ts'
import { rootPaths } from './root.ts'
import { safeJoin } from './safepath.ts'
import type { Store } from './store.ts'
import { t } from './i18n.ts'

/**
 * What RomMix believes is on this disk, and whether the disk agrees.
 *
 * The index records what was downloaded; it is not the truth about the disk,
 * and the two drift apart easily — a backup was restored, the ROM folder moved
 * with an emulator while the index stayed, or the files were put there by
 * something else entirely. Everything here exists to close that gap without
 * making the user re-download a game they already have.
 *
 * Kept apart from the transfer queue because the two share nothing but a
 * destination. A download is a thing in flight with a progress bar and a state
 * machine; this is a question asked of the filesystem. `DownloadManager` asks
 * this where a ROM should land and hands back what arrived — see `plan` and
 * `entryFor` — and nothing here knows a queue exists.
 */

/**
 * How long a system folder's contents are answered for from the last reading.
 *
 * Long enough that walking a library reads each folder once rather than once
 * per page of covers, short enough that a game copied in from a file manager is
 * recognised the next time a page is looked at rather than after a restart.
 * Anything RomMix writes itself drops the lot — see `forgetListings`.
 */
const LISTING_LIFETIME_MS = 5_000

export class Library extends EventEmitter {
  /**
   * System folders as they were last read, for a moment. See
   * `LISTING_LIFETIME_MS`.
   *
   * The reading, not what it produced: two pages of a library asking about the
   * same folder at once then wait on one `readdir` rather than starting two.
   */
  private readonly listings = new Map<string, { at: number; reading: Promise<DirListing> }>()

  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    private readonly getEmulator: (system?: string) => EmulatorState | null
  ) {
    super()
  }

  /** True when downloads go to RomMix's own shared tree. See `RomStorage`. */
  private get shared(): boolean {
    return this.store.settings.romStorage === 'rommix'
  }

  /**
   * Is this entry a copy that is no longer where RomMix would look for it?
   *
   * With per-emulator storage each emulator keeps its games in its own tree, so
   * pointing a platform at a different emulator does not move anything — the
   * file stays where it was, in a folder the new emulator never looks at.
   * Continuing to show the game as downloaded would leave the user with a Play
   * button that launches an emulator against a ROM outside its library, or
   * nothing to press to get a copy where it now belongs.
   *
   * A *missing* emulator is not a changed one: with nothing installed for the
   * platform there is no new answer, so the entry is left alone rather than
   * making an unplugged Steam Deck look like it lost its library.
   *
   * Shared storage removes the question entirely — one tree, whoever is in
   * charge — so the only thing that can be stale there is a game downloaded
   * under the *other* setting, and vice versa. Switching the setting therefore
   * hides the old copies rather than deleting them, and switching back brings
   * them straight home; `adopt` finds whichever set is in the right place now.
   */
  isStale(entry: InstalledRom): boolean {
    if (this.shared) return entry.emulatorId !== SHARED_LIBRARY
    if (entry.emulatorId === SHARED_LIBRARY) return true

    const current = this.getEmulator(entry.system)
    if (!current) return false
    return current.id !== entry.emulatorId
  }

  /** The index entry for a ROM, unless it belongs to a different emulator. */
  installedNow(romId: number): InstalledRom | undefined {
    const entry = this.store.getInstalled(romId)
    return entry && !this.isStale(entry) ? entry : undefined
  }

  /** Everything on disk for the emulators currently in charge. */
  get installed(): InstalledRom[] {
    return this.store.installed.filter((entry) => !this.isStale(entry))
  }

  /**
   * Work out where a ROM should land. Returns the target path plus whether it
   * needs to be unpacked into a directory of its own.
   */
  plan(rom: RommRom): {
    dir: string
    path: string
    system: string
    emulatorId: string
    asDirectory: boolean
    flat: boolean
  } {
    // The system is worked out first: it decides which emulators are even
    // candidates, so asking for one before knowing the system could pick an
    // emulator that cannot run this ROM.
    const system = resolveSystem(
      rom.platform_slug,
      rom.platform_fs_slug,
      this.store.settings.systemOverrides
    )
    if (!system) {
      throw new RommError(
        t('error.noFolderMapping', {
          platform: rom.platform_display_name,
          slug: rom.platform_slug
        })
      )
    }

    const emulator = this.getEmulator(system)

    /**
     * The tree this game belongs in, and what to record it under.
     *
     * With shared storage an emulator is welcome but not required: the folder
     * is RomMix's own, so there is somewhere to put the game whether or not
     * anything can yet play it — which is the whole point of the setting.
     * Per-emulator storage has no such answer, because the destination *is* the
     * emulator, so a missing one is a refusal rather than a fallback.
     */
    const library = ((): { root: string | null; emulatorId: string } => {
      if (this.shared) return { root: rootPaths().roms, emulatorId: SHARED_LIBRARY }
      if (emulator) return { root: emulator.paths.roms, emulatorId: emulator.id }

      // Named from the registry rather than written out, so this cannot go on
      // recommending an emulator RomMix no longer ships a descriptor for.
      const covers = emulatorsForSystem(system)
        .map((descriptor) => descriptor.name)
        .join(' or ')
      throw new RommError(
        covers
          ? t('error.noEmulatorInstallOne', { system, name: covers })
          : t('error.noEmulatorForSystem', { system })
      )
    })()

    // Every descriptor declares a ROM folder, so this is only null when the
    // emulator was found but never probed.
    if (!library.root) {
      throw new RommError(t('error.noRomFolder', { name: emulator?.name ?? 'RomMix' }))
    }

    // Multi-file games (CD images with cue+bin, multi-disc sets) get a directory
    // of their own — unless the emulator reads its library flat, in which case
    // a folder is a place its game list will never look and the files go loose
    // into the system folder instead. With no emulator at all there is nothing
    // making that demand, and a directory is the shape that keeps a disc set
    // together for whichever one arrives later.
    const flat = emulator ? emulatorById(emulator.id)?.flatLibrary === true : false
    const asDirectory = rom.has_multiple_files && !flat
    const dir = join(library.root, system)

    // The name is the server's, and it is what decides where this lands. One
    // that climbs out of the system folder is refused: the whole point of the
    // layout is that an emulator finds the game by the folder it is in.
    const path = safeJoin(dir, asDirectory ? rom.fs_name_no_ext : installName(rom))
    if (!path) {
      throw new RommError(t('error.unsafeName', { name: rom.fs_name }))
    }
    return { dir, path, system, emulatorId: library.emulatorId, asDirectory, flat }
  }

  /**
   * The index entry for a game that is now on disk, built but not recorded.
   *
   * Recording is the caller's, because the two callers record differently: a
   * finished download is one game and is written and announced as it lands,
   * while adoption recognises a whole library page and writes the lot once.
   * See `Store.addInstalledMany`.
   */
  async entryFor(
    rom: RommRom,
    system: string,
    emulatorId: string,
    installed: InstallResult
  ): Promise<InstalledRom> {
    const entry: InstalledRom = {
      romId: rom.id,
      emulatorId,
      path: installed.path,
      launchPath: installed.launchPath,
      name: rom.name ?? rom.fs_name,
      coverPath: rom.path_cover_small ?? rom.path_cover_large,
      files: installed.isDirectory
        ? (await readdir(installed.path).catch(() => [])).sort()
        : (installed.files ?? [basename(installed.path)]),
      system,
      platformName: rom.platform_display_name,
      fileName: basename(installed.path),
      sizeBytes: installed.sizeBytes,
      installedAt: new Date().toISOString(),
      isDirectory: installed.isDirectory
    }
    return entry
  }

  /** What is in a system folder, read again only once the last reading is old. */
  private async listing(dir: string): Promise<DirListing> {
    const now = Date.now()
    const held = this.listings.get(dir)
    if (held && now - held.at < LISTING_LIFETIME_MS) return held.reading

    /**
     * Everything else that has gone stale goes at the same time.
     *
     * A reading is otherwise only ever replaced by another look at the same
     * folder, so a platform browsed once and left behind held its whole
     * contents until something was downloaded — and a library of any size is
     * that folder's worth of entries per platform visited, kept for nothing.
     */
    for (const [path, entry] of this.listings) {
      if (now - entry.at >= LISTING_LIFETIME_MS) this.listings.delete(path)
    }

    const reading = listDir(dir)
    this.listings.set(dir, { at: now, reading })
    return reading
  }

  /**
   * Forget every folder reading, because RomMix has just changed one.
   *
   * Called wherever the ROM tree is written to, which includes deleting from
   * it: the files a cancelled multi-file transfer had already fetched are real
   * files under their real names, and a reading taken before they went says the
   * game is complete. Adoption believes it, and records an entry pointing at
   * nothing.
   *
   * All of them rather than the one written to: a game is installed into a
   * system folder, but which folder that is depends on the emulator in charge
   * of the platform, and a multi-file game changes the folder above it as well.
   * There are a handful of these and re-reading one costs a `readdir`.
   */
  forgetListings(): void {
    this.listings.clear()
  }

  /**
   * Adopt ROMs that are already on disk but missing from the index.
   *
   * The index records what RomMix downloaded; it is not the truth about
   * the disk, and the two drift apart easily — the index moved with RomMix's
   * folder while the ROMs stayed in the emulator's library, a backup was
   * restored, or the files were put there by something else. Making the user
   * download a game they already have because a JSON file went missing is the
   * wrong answer, so each ROM the UI asks about is checked against the place
   * it would have been installed to.
   *
   * Two stats per unknown ROM, and only for what is actually on screen — plus
   * at most one listing per system folder, for the ROMs whose installed name is
   * not their name on the server.
   */
  async adopt(roms: readonly RommRom[]): Promise<InstalledRom[]> {
    const adopted: InstalledRom[] = []
    const unfinished = new Set(this.store.pending.map((entry) => entry.romId))

    for (const rom of roms) {
      // A stale entry — the platform now runs on a different emulator — is
      // treated as unknown, so the new emulator's own library is searched. If
      // a copy is there it is adopted; if not, the old entry stays put and
      // comes back the moment the platform is pointed back.
      const known = this.store.getInstalled(rom.id)
      if (known && !this.isStale(known)) continue

      // A game part-way through being fetched has real files in the real place
      // — that is what fetching it file by file means — and every one of the
      // checks below would take them for a finished install. It is not one
      // until the transfer says so.
      if (unfinished.has(rom.id)) continue

      let target: { dir: string; system: string; emulatorId: string; flat: boolean }
      try {
        target = this.plan(rom)
      } catch {
        // Unmapped platform, or no emulator can run it: nothing to look for.
        continue
      }

      const record = async (path: string, isDirectory: boolean): Promise<void> => {
        // A directory with nothing in it is not a game. It is what a cancelled
        // transfer or a copy that never finished leaves behind, and recording
        // it puts a download of nothing in the index — which then reads as
        // installed everywhere and refuses to be downloaded.
        if (isDirectory && (await readdir(path).catch(() => [])).length === 0) return

        adopted.push(
          await this.entryFor(rom, target.system, target.emulatorId, {
            path,
            launchPath: isDirectory ? ((await pickLaunchFile(path, target.system)) ?? path) : path,
            sizeBytes: isDirectory
              ? await directorySize(path).catch(() => 0)
              : ((await stat(path).catch(() => null))?.size ?? 0),
            isDirectory
          })
        )
      }

      /**
       * The folder as it stands, for the two questions no single path answers.
       *
       * Held across calls as well as within one, so a library scrolled from the
       * top reads each system folder once rather than once per page of covers.
       * See `listing`.
       */
      const present = await this.listing(target.dir)

      /**
       * A game installed loose, for an emulator that reads its library flat.
       *
       * There is no one path to stat: the game is several files sharing the
       * system folder with every other game, under the names they have on the
       * server rather than anything derived from `fs_name`. Every one of them
       * has to be there before this counts as the game — a half-copied set
       * adopted as complete is a Play button that fails at load.
       */
      if (target.flat && rom.files.length > 1) {
        const wanted = rom.files.map((file) => file.file_name)
        const found = wanted.filter((name) => present.byName.has(name.toLowerCase()))

        if (found.length === wanted.length) {
          const sized = await Promise.all(
            found.map(async (name) => ({
              name,
              sizeBytes: (await stat(join(target.dir, name)).catch(() => null))?.size ?? 0
            }))
          )
          const launch = join(target.dir, chooseLaunchFile(sized, target.system) ?? found[0])
          adopted.push(
            await this.entryFor(rom, target.system, target.emulatorId, {
              path: launch,
              launchPath: launch,
              sizeBytes: sized.reduce((sum, file) => sum + file.sizeBytes, 0),
              isDirectory: false,
              files: found
            })
          )
          continue
        }
      }

      // The shapes an install can take, matching what `plan` and `unpack`
      // produce. Both names are tried for a file: `installName` is what a fresh
      // download is called, `fs_name` what one from before that rule was.
      //
      // Asked of the filesystem rather than of the reading above, which is
      // indexed from a `readdir` and so answers for the link rather than for
      // what it points at. A ROM library kept elsewhere and linked into the
      // emulator's folder is a game like any other, and `stat` is what says so.
      //
      // Each is checked for staying inside the system folder, as `plan` checks
      // the one it writes to: a name that climbs out would be adopted here and
      // then deleted by `uninstall`, which removes what the index points at.
      const asFile = safeJoin(target.dir, installName(rom))
      const asNamedOnServer = safeJoin(target.dir, rom.fs_name)
      const asDirectory = safeJoin(target.dir, rom.fs_name_no_ext)
      if (!asFile || !asNamedOnServer || !asDirectory) continue

      const fileInfo = await stat(asFile).catch(() => null)
      if (fileInfo?.isFile()) {
        await record(asFile, false)
        continue
      }

      if (asNamedOnServer !== asFile) {
        const legacy = await stat(asNamedOnServer).catch(() => null)
        if (legacy?.isFile()) {
          await record(asNamedOnServer, false)
          continue
        }
      }

      const dirInfo = await stat(asDirectory).catch(() => null)
      if (dirInfo?.isDirectory()) {
        await record(asDirectory, true)
        continue
      }

      /**
       * Last resort: the same game under a different extension.
       *
       * A ROM the server holds zipped is installed unpacked, so what is on disk
       * is the name from inside the archive and never `fs_name` — which would
       * make every zipped ROM in the library invisible here, and adoption is
       * exactly what has to work for those. The same lookup covers a file the
       * user renamed by hand, which on Sega hardware is routine: a cartridge
       * dumped as `.bin` has to become `.md` before an emulator will take it.
       *
       * Matched on the name with the extension dropped, which is the part RomM
       * and the disk still agree on, and only after both exact answers have
       * failed — so a folder holding both `Game.bin` and `Game.md` as separate
       * library entries still resolves each to its own file.
       */
      const sibling = present.byStem.get(rom.fs_name_no_ext.toLowerCase())
      if (sibling) await record(join(target.dir, sibling.name), sibling.isDirectory())
    }

    // Recorded and announced as a group: a library page can adopt dozens at
    // once, one notification per game would bury the screen, and every listener
    // on `installed` is handed the whole index — so an entry at a time is a
    // rewrite of the index and a redraw of every screen, per game.
    if (adopted.length > 0) {
      this.store.addInstalledMany(adopted)
      log.info('library', 'adopted ROMs already on disk', {
        count: adopted.length,
        romIds: adopted.map((entry) => entry.romId)
      })
      // Before the news of what was adopted, so the screen that shows it is
      // reading a library the new games are already in.
      this.emit('installed')
      this.emit('adopted', adopted)
    }
    return adopted
  }

  /**
   * Reconcile the whole index against the disk, on demand.
   *
   * `adopt` only ever looks at the ROMs a screen happens to have loaded, which
   * is right for browsing — two stats per game, and only for what is visible —
   * but it means a library page never visited stays wrong indefinitely. Games
   * deleted with a file manager keep a Play button, and ROMs copied in by hand
   * are still offered as downloads.
   *
   * This walks the entire server library once, so the answer afterwards is
   * complete rather than "complete for what you happened to scroll past".
   * Paged rather than fetched whole: a large library is tens of thousands of
   * ROMs, and this way the progress callback has something to report.
   */
  async sync(onProgress?: (checked: number, total: number) => void): Promise<LibrarySyncResult> {
    // Drop what is gone first, so a game deleted from disk and then re-copied
    // elsewhere is re-adopted in the same pass rather than the next one.
    const removed = this.store.pruneInstalled()
    log.info('library', 'checking the whole library against the disk', { removed })

    const PAGE = 200
    let checked = 0
    let adopted = 0
    let total = 0

    do {
      const page = await this.client.roms({ limit: PAGE, offset: checked })
      total = page.total
      if (page.items.length === 0) break
      adopted += (await this.adopt(page.items)).length
      checked += page.items.length
      onProgress?.(checked, total)
    } while (checked < total)

    if (removed > 0) this.emit('installed')
    return { checked, removed, adopted }
  }

  /**
   * The file to hand an emulator for an installed ROM.
   *
   * An entry whose recorded file has since gone is resolved from disk instead,
   * so a game whose directory was reorganised does not have to be downloaded
   * again to become playable. The same for one whose recorded file is not a
   * thing this system can be handed at all: the index keeps whatever the rule
   * said on the day of the download, and a Switch game installed before the
   * playlist stopped winning has an `.m3u` written into it that Eden cannot
   * load. Choosing again from disk fixes those without a reinstall.
   */
  async launchTarget(entry: InstalledRom): Promise<string> {
    if (existsSync(entry.launchPath) && isLaunchable(entry.launchPath, entry.system)) {
      return entry.launchPath
    }
    if (entry.isDirectory) return (await pickLaunchFile(entry.path, entry.system)) ?? entry.path

    // Loose in the system folder: the game is the files the entry lists, not
    // the directory it shares with every other game on the platform.
    const dir = dirname(entry.path)
    const sized = await Promise.all(
      entry.files.map(async (name) => ({
        name,
        sizeBytes: (await stat(join(dir, name)).catch(() => null))?.size ?? 0
      }))
    )
    const chosen = chooseLaunchFile(sized, entry.system)
    return chosen ? join(dir, chosen) : entry.path
  }

  /**
   * What each of an installed game's files weighs on this disk.
   *
   * Measured on demand rather than recorded at install time: the index keeps
   * one total for the game, and the files themselves outlive it — an emulator
   * converts a disc image in place, a missing track is copied in by hand. A
   * file the index names and the disk no longer has is left out, so the game
   * screen shows nothing for it rather than nothing at all.
   */
  async localFiles(romId: number): Promise<GameFile[]> {
    const entry = this.store.getInstalled(romId)
    if (!entry) return []

    // Loose in the system folder: the entry's names are siblings of `path`,
    // not children of it.
    const dir = entry.isDirectory ? entry.path : dirname(entry.path)
    const sized = await Promise.all(
      entry.files.map(async (name) => {
        const found = await stat(join(dir, name)).catch(() => null)
        if (!found) return null
        // A directory install lists whatever sits at its top level, which for
        // a game that arrived with its own subfolders includes directories.
        const sizeBytes = found.isDirectory()
          ? await directorySize(join(dir, name)).catch(() => 0)
          : found.size
        return { name, sizeBytes }
      })
    )
    return sized.filter((file) => file !== null)
  }

  /**
   * Delete a ROM from disk and drop it from the index.
   *
   * A game installed loose — several files in the system folder, for an
   * emulator that reads its library flat — is every one of those files, not
   * just the one that launches it. Removing only `path` would leave the rest
   * behind as unattributable clutter in a folder shared with every other game.
   */
  async uninstall(romId: number): Promise<void> {
    const entry = this.store.getInstalled(romId)
    if (!entry) {
      log.warn('library', 'uninstall asked for a ROM that is not in the index', { romId })
      return
    }

    // Before the deletion rather than after: what was removed is the whole
    // point of the line, and a failure part-way through leaves it recorded.
    log.info('library', 'uninstalling', {
      romId,
      name: entry.name,
      path: entry.path,
      files: entry.isDirectory ? 'whole directory' : entry.files,
      sizeBytes: entry.sizeBytes
    })

    if (!entry.isDirectory && entry.files.length > 1) {
      const dir = dirname(entry.path)
      for (const file of entry.files) await rm(join(dir, file), { force: true })
    } else {
      await rm(entry.path, { recursive: true, force: true })
    }
    this.forgetListings()
    this.store.removeInstalled(romId)
  }

  /**
   * Record a game that has just been downloaded, and say so.
   *
   * The counterpart to `adopt` for the one-at-a-time case: a finished transfer
   * is a single game and is written and announced as it lands, where adoption
   * recognises a whole page and writes the lot once. Both drop the folder
   * readings first — the tree has just changed underneath them.
   */
  record(entry: InstalledRom): void {
    this.forgetListings()
    this.store.addInstalled(entry)
    this.emit('installed')
  }
}

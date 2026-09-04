import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { localize } from '@shared/i18n'
import { biosFor } from '@config/bios'
import { emulatorById } from '@config/emulators'
import { resolveSystem, systemLabel } from '@config/systems'
import { i18n, t } from './i18n.ts'
import { realHome } from './xdg.ts'
import { log } from './log.ts'
import { safeJoin } from './safepath.ts'
import { rootPaths } from './root.ts'
import { fileSystemEnvironment } from './saveenv.ts'
import type {
  BiosItem,
  BiosPlatform,
  BiosReport,
  BiosSyncResult,
  EmulatorState,
  RommFirmware,
  RommPlatform,
  SaveEnvironment
} from '@shared/types'
import type { BiosProgress } from '@shared/api'
import type { OfflineCache } from './offline.ts'
import { refusedUs, RommClient, RommError } from './romm/index.ts'
import type { Store } from './store.ts'

/**
 * What an install reports while it runs: which file, how far into it, and how
 * far into the run it is. See `BiosProgress`.
 */
type BiosListener = (progress: BiosProgress) => void

/** The console a file belongs to, as the dialog installing it names it. */
function subjectOf(platform: BiosPlatform): NonNullable<BiosProgress['platform']> {
  return { name: platform.platformName, slug: platform.platformSlug, system: platform.system }
}

/**
 * BIOS files: what each platform needs, what the RomM server holds, and what is
 * already sitting in the emulator that runs it.
 *
 * RomM is the only source. BIOS images are not distributable and not
 * guessable, so "install" here means copying a file the user already uploaded
 * to their own server into the emulator that will look for it — never fetching
 * one from the internet.
 *
 * Where it goes is the emulator's business, not the platform's: the same
 * PlayStation BIOS belongs in RetroDECK's `bios/` or RetroArch's `system/`
 * depending on which one is set to run PlayStation, which is why the target is
 * resolved through the same platform -> emulator map the launcher uses.
 */

/** Filenames compare case-insensitively; emulators and uploads disagree on case. */
function key(name: string): string {
  return name.toLowerCase()
}

/**
 * The directory one BIOS file is to be copied into, or null when the emulator
 * cannot be given it at all.
 *
 * The whole answer is the descriptor's: a frontend that files firmware under
 * `bios/dc/` and one that drops everything at the root are both ordinary, and
 * nothing outside the emulator knows which it is. A descriptor that says
 * nothing means the BIOS folder itself, which is what a BIOS folder normally
 * is.
 */
function targetOf(
  emulator: EmulatorState,
  system: string,
  fileName: string,
  env: SaveEnvironment
): string | null {
  const place = emulatorById(emulator.id)?.bios
  if (!place) return emulator.paths.bios
  return place({
    system,
    fileName,
    paths: emulator.paths,
    configDir: emulator.configDir,
    dataDir: emulator.dataDir,
    installDir: emulator.install?.location ?? null,
    home: realHome(),
    env
  })
}

/**
 * Every filename already in an emulator's BIOS folder, one level of
 * subdirectories included.
 *
 * The subdirectory sweep is not cosmetic: RetroDECK sorts some BIOS files into
 * per-emulator folders (`bios/dc/`, `bios/pcsx2/`), and a flat listing would
 * report a file the user placed there by hand as missing and then install a
 * second copy at the root.
 */
async function existingFiles(dir: string): Promise<Set<string>> {
  const found = new Set<string>()
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      found.add(key(entry.name))
      continue
    }
    if (!entry.isDirectory()) continue
    for (const child of await readdir(join(dir, entry.name)).catch(() => [])) {
      found.add(key(child))
    }
  }
  return found
}

export class BiosManager {
  /**
   * The read-only view of the disk descriptors answer `bios` against — one per
   * manager, because it is also the key their manifest caches hang off.
   */
  private readonly env = fileSystemEnvironment()

  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    private readonly offline: OfflineCache,
    private readonly getEmulator: (system?: string) => EmulatorState | null
  ) {}

  /** The whole picture, one platform per row. */
  async report(): Promise<BiosReport> {
    return (await this.scan()).report
  }

  /**
   * Take the server's half and keep it, without describing anything.
   *
   * For the one moment nobody is looking at this screen and it matters anyway:
   * a device that has never opened it has no firmware written down, and the
   * first time that is noticed is the first time it is out of range and a game
   * will not start. One request per platform, so it is taken once and then left
   * to the screen itself to keep current. See `RomMixApp.catchUp`.
   */
  async capture(): Promise<void> {
    await this.serverHalf()
  }

  /**
   * One platform's row, for a screen that is about a single game.
   *
   * A full `scan` asks the server for firmware once per platform, which is far
   * too much work to do every time a game is opened. This is the same
   * description of one row at the cost of two calls.
   *
   * Null means the server has no such platform, which is not a failure: RomMix
   * knows platforms a given server has never heard of. A server that cannot be
   * reached and has never been saved is the other null — the answer is not
   * knowable, the game is about to start regardless, and a notification about
   * a warning that could not be computed helps nobody.
   *
   * Anything else throws. A refusal used to return null as well, and the game
   * page then drew exactly what it draws for a platform with nothing wrong —
   * no warning at all. The page still opens either way, because the caller
   * keeps its own `catch`; what changes is that the user is told.
   */
  async platformReport(platformId: number): Promise<BiosPlatform | null> {
    // Deliberately not `serverHalf`, which asks after every platform's
    // firmware: this is opened every time a game is, and the cost of that
    // whole pass is the reason this method exists at all.
    let platform: RommPlatform | undefined
    let firmware: readonly RommFirmware[]
    try {
      platform = (await this.client.platforms()).find((row) => row.id === platformId)
      if (!platform) return null
      firmware = await this.client.firmware(platformId)
    } catch (cause) {
      // A refusal is reported rather than papered over, as it is for the whole
      // screen: this is the one call that would otherwise turn a token missing
      // `firmware.read` into a game page with no warning on it at all.
      if (refusedUs(cause)) throw cause
      const platforms = await this.offline.platforms()
      const held = platforms ? await this.offline.firmware() : null
      if (!platforms || !held) {
        log.info('bios', 'nothing to check this platform against', {
          platformId,
          reason: (cause as Error).message
        })
        return null
      }
      platform = platforms.find((row) => row.id === platformId)
      if (!platform) return null
      firmware = held[platformId] ?? []
    }

    const listings = new Map<string, Set<string>>()
    const listing = async (dir: string): Promise<Set<string>> => {
      const cached = listings.get(dir)
      if (cached) return cached
      const found = await existingFiles(dir)
      listings.set(dir, found)
      return found
    }
    return await this.describe(platform, firmware, listing)
  }

  /**
   * Everything the screen shows, plus the two things installing needs that a
   * serialisable report cannot carry: the firmware records themselves, and
   * where each one belongs.
   *
   * One pass, because every caller needs all of it — without this, installing
   * forty files would rebuild the whole picture forty times.
   *
   * Firmware has to be asked for one platform at a time. RomM's firmware
   * response carries no platform id, so the only thing tying a file to a
   * platform is the `?platform_id=` it was requested with; fetching the lot in
   * one call would leave every file unattributable. The requests go out in
   * small batches rather than all at once, so a server with forty platforms is
   * not hit with forty simultaneous connections.
   */
  private async scan(): Promise<{
    report: BiosReport
    firmwareById: Map<number, RommFirmware>
    dirFor: Map<number, string>
  }> {
    const { platforms, byPlatform } = await this.serverHalf()

    // One listing per BIOS folder, not per platform: several platforms share
    // an emulator, and therefore share the folder.
    const listings = new Map<string, Set<string>>()
    const listing = async (dir: string): Promise<Set<string>> => {
      const cached = listings.get(dir)
      if (cached) return cached
      const found = await existingFiles(dir)
      listings.set(dir, found)
      return found
    }

    const rows: BiosPlatform[] = []
    // Per file, not per platform: a Switch row sends its keys to Eden and its
    // firmware to RomMix's own folder, and only the row knows which is which.
    const dirFor = new Map<number, string>()
    for (const platform of platforms) {
      const row = await this.describe(platform, byPlatform.get(platform.id) ?? [], listing)
      rows.push(row)
      for (const item of row.items) {
        if (item.firmwareId != null && item.dir) dirFor.set(item.firmwareId, item.dir)
      }
    }

    // Platforms that need something come first — the point of the screen is
    // what is missing, and a server with forty platforms buries it otherwise.
    rows.sort((a, b) => {
      const rank = (row: BiosPlatform): number =>
        row.items.some((item) => item.required && !item.installed)
          ? 0
          : row.items.some((item) => !item.installed)
            ? 1
            : row.items.length > 0
              ? 2
              : 3
      return rank(a) - rank(b) || a.platformName.localeCompare(b.platformName)
    })

    return {
      report: { platforms: rows },
      firmwareById: new Map(
        [...byPlatform.values()].flat().map((item) => [item.id, item] as const)
      ),
      dirFor
    }
  }

  /**
   * The half of this screen that is the server's: its platforms, and the
   * firmware it holds for each.
   *
   * Split out because it is the only half that can be unreachable, and because
   * what is left — which files are required, and which are already in place —
   * is a question for this disk and is worth answering on its own. Away from
   * the network the last live answer stands in, so the screen still says what
   * each console needs and what is missing; only the column saying what the
   * server could supply is as old as the last time it was asked.
   *
   * Kept whole, and written only when every platform answered: a firmware list
   * is tied to its platform by the id it was requested with and by nothing
   * else, so half of one saved over a good copy would attribute files to the
   * wrong consoles.
   */
  private async serverHalf(): Promise<{
    platforms: RommPlatform[]
    byPlatform: Map<number, RommFirmware[]>
  }> {
    let platforms: RommPlatform[]
    try {
      platforms = await this.client.platforms()
    } catch (cause) {
      // Both halves or neither. A platform list with no firmware behind it
      // draws every file on every console as missing and absent from the
      // server, which is a screen that sends people looking for BIOS files
      // they may well already have uploaded. And neither half stands in for a
      // request RomM refused — a token without `platforms.read` would draw
      // last week's screen with nothing to say why.
      const held = refusedUs(cause) ? null : await this.offline.platforms()
      const firmware = held ? await this.offline.firmware() : null
      if (!held || !firmware) throw cause
      log.info('bios', 'the server did not answer, describing what it last held', {
        reason: (cause as Error).message
      })
      return {
        platforms: held,
        byPlatform: new Map(
          Object.entries(firmware).map(([id, items]) => [Number(id), items] as const)
        )
      }
    }

    const byPlatform = new Map<number, RommFirmware[]>()
    const failures: string[] = []
    const BATCH = 6
    for (let i = 0; i < platforms.length; i += BATCH) {
      await Promise.all(
        platforms.slice(i, i + BATCH).map(async (platform) => {
          try {
            byPlatform.set(platform.id, await this.client.firmware(platform.id))
          } catch (cause) {
            byPlatform.set(platform.id, [])
            failures.push((cause as Error).message)
            log.warn('bios', 'the server refused to list firmware', {
              platform: platform.slug,
              reason: (cause as Error).message
            })
          }
        })
      )
    }

    // A refused firmware call must not be reported as an empty one. Swallowing
    // it produces the most misleading screen RomMix can draw: every file listed
    // as missing and absent from the server, when the truth is that the server
    // was never asked successfully — which is what a token paired without the
    // `firmware.read` scope does to this screen.
    //
    // One failure fails the scan rather than marking that row, because there is
    // only one firmware endpoint: whatever refused it for one platform is going
    // to refuse it for the rest. A refusal is also not something to fall back
    // to the saved copy over: the server is right there and saying no, and a
    // screen drawn from last week would hide that.
    if (failures.length > 0) {
      throw new RommError(t('error.biosListFailed', { reason: failures[0] }))
    }

    await this.offline.savePlatforms(platforms)
    await this.offline.saveFirmware(Object.fromEntries(byPlatform))
    return { platforms, byPlatform }
  }

  private async describe(
    platform: RommPlatform,
    firmware: readonly RommFirmware[],
    listing: (dir: string) => Promise<Set<string>>
  ): Promise<BiosPlatform> {
    const system = resolveSystem(
      platform.slug,
      platform.fs_slug,
      this.store.settings.systemOverrides
    )
    const emulator = system ? this.getEmulator(system) : null
    const biosDir = emulator?.paths.bios ?? null
    const requirement = system ? biosFor(system) : null

    /**
     * Where one file belongs, and whether that is the emulator's own folder.
     *
     * Asked per file rather than per platform: a Switch row holds both keys,
     * which go straight into Eden, and firmware, which cannot.
     */
    const placement = (fileName: string): { dir: string | null; staged: boolean } => {
      // Nothing to ask when the emulator or its BIOS folder is unknown: the
      // row is blocked either way, and `blockedReason` below says which.
      if (!emulator || !system || !biosDir) return { dir: null, staged: false }
      const target = targetOf(emulator, system, fileName, this.env)
      if (target !== null) return { dir: target, staged: false }
      return { dir: this.stagingDir(system), staged: true }
    }

    /** Present already — checked in the folder this file actually goes to. */
    const isInstalled = async (fileName: string, dir: string | null): Promise<boolean> => {
      if (!dir) return false
      return (await listing(dir)).has(key(fileName))
    }

    // Start from what the system is known to need, so a file the server does
    // not hold is still named — "PlayStation is missing scph5501.bin" is
    // actionable in a way that an empty list is not.
    const items = new Map<string, BiosItem>()
    for (const file of requirement?.files ?? []) {
      const { dir, staged } = placement(file.name)
      items.set(key(file.name), {
        fileName: file.name,
        note: t(file.note),
        required: file.required,
        installed: await isInstalled(file.name, dir),
        dir,
        staged,
        firmwareId: null,
        sizeBytes: 0,
        verified: false
      })
    }

    // Then everything the server actually holds, which both fills in the ids
    // for the rows above and adds files RomMix has no expectations about.
    for (const item of firmware) {
      const existing = items.get(key(item.file_name))
      const { dir, staged } = placement(item.file_name)
      items.set(key(item.file_name), {
        fileName: item.file_name,
        note: existing?.note ?? null,
        required: existing?.required ?? false,
        installed: await isInstalled(item.file_name, dir),
        dir,
        staged,
        firmwareId: item.id,
        sizeBytes: item.file_size_bytes,
        verified: item.is_verified
      })
    }

    const blockedReason = !system
      ? t('bios.blockedNoMapping', { platform: platform.display_name })
      : !emulator
        ? t('bios.blockedNoEmulator', { system: systemLabel(system) })
        : !biosDir
          ? t('bios.blockedNoFolder', { name: emulator.name })
          : null

    const rows = [...items.values()].sort((a, b) => a.fileName.localeCompare(b.fileName))

    return {
      platformId: platform.id,
      platformSlug: platform.slug,
      platformName: platform.display_name,
      system,
      emulatorId: emulator?.id ?? null,
      emulatorName: emulator?.name ?? null,
      biosDir,
      // Only worth saying when something on this row actually was staged.
      stagingNote: rows.some((row) => row.staged)
        ? localize((emulator ? emulatorById(emulator.id)?.biosStagingNote : null) ?? null, i18n())
        : null,
      items: rows,
      blockedReason,
      setupNote: requirement?.setupNote ? t(requirement.setupNote) : null
    }
  }

  /**
   * RomMix's own BIOS folder for a system.
   *
   * Where firmware goes that RomMix can fetch but not install — beside the
   * roms folder in the RomMix root, so it moves with everything else when the
   * root is repointed, and is somewhere the user can find and point an
   * emulator's own installer at.
   */
  private stagingDir(system: string): string {
    return join(rootPaths().root, 'bios', system)
  }

  /**
   * Copy one firmware file from RomM into the emulator that needs it.
   *
   * Reported as a run of one, so the screen has the same thing to draw whether
   * a file was asked for on its own or as part of everything outstanding.
   */
  async install(firmwareId: number, onProgress?: BiosListener): Promise<string> {
    const { report, firmwareById, dirFor } = await this.scan()
    const fileName = firmwareById.get(firmwareId)?.file_name ?? null
    const platform = report.platforms.find((row) =>
      row.items.some((item) => item.firmwareId === firmwareId)
    )
    return this.place(firmwareId, firmwareById, dirFor, report, (received, total) =>
      onProgress?.({
        done: 0,
        total: 1,
        fileName,
        platform: platform ? subjectOf(platform) : null,
        receivedBytes: received,
        totalBytes: total
      })
    )
  }

  /**
   * Install everything the server holds that is not already in place, for one
   * platform or for all of them.
   *
   * Failures are counted rather than thrown: one platform whose emulator is
   * missing should not stop the other thirty from being set up, and the count
   * is what the screen reports.
   */
  async syncAll(platformId?: number | null, onProgress?: BiosListener): Promise<BiosSyncResult> {
    const { report, firmwareById, dirFor } = await this.scan()

    // Scoped by platform id rather than by the caller handing over a row: the
    // rows it is holding came from an earlier scan, and what is installed can
    // have changed since it drew them.
    const rows =
      platformId == null
        ? report.platforms
        : report.platforms.filter((row) => row.platformId === platformId)

    // The console each file belongs to is carried along with it: flattened to
    // items alone, the one thing that makes a BIOS file name mean anything is
    // gone by the time there is a dialog to name it in.
    const pending = rows.flatMap((row) =>
      row.items.filter((item) => !item.installed).map((item) => ({ row, item }))
    )
    const fetchable = pending.filter((entry) => entry.item.firmwareId != null)

    let installed = 0
    let failed = 0
    let done = 0

    log.info('bios', 'installing everything the server holds', {
      platformId: platformId ?? 'all',
      pending: pending.length,
      fetchable: fetchable.length
    })

    for (const { row, item } of fetchable) {
      try {
        await this.place(
          item.firmwareId as number,
          firmwareById,
          dirFor,
          report,
          (received, total) =>
            onProgress?.({
              done,
              total: fetchable.length,
              fileName: item.fileName,
              platform: subjectOf(row),
              receivedBytes: received,
              totalBytes: total
            })
        )
        installed += 1
      } catch (cause) {
        failed += 1
        // Counted rather than thrown, so without this the only record of which
        // file could not be placed — and why — is a number on a screen.
        log.error('bios', 'could not install a BIOS file', cause, {
          fileName: item.fileName,
          firmwareId: item.firmwareId,
          dir: item.dir
        })
      }
      done += 1
      // The file that has just gone by, whether it arrived or failed: without
      // this the count only moves when the next file's first bytes turn up, and
      // the last one of a run never moves it at all.
      onProgress?.({
        done,
        total: fetchable.length,
        fileName: item.fileName,
        platform: subjectOf(row),
        receivedBytes: 0,
        totalBytes: 0
      })
    }

    log.info('bios', 'finished installing', {
      installed,
      failed,
      unavailable: pending.length - fetchable.length
    })

    return {
      installed,
      failed,
      // Files a system is known to need that the server does not hold. A gap
      // for the user to fill by uploading them, not a failure of the sync.
      unavailable: pending.length - fetchable.length
    }
  }

  private async place(
    firmwareId: number,
    firmwareById: Map<number, RommFirmware>,
    dirFor: Map<number, string>,
    report: BiosReport,
    onProgress?: (received: number, total: number) => void
  ): Promise<string> {
    const firmware = firmwareById.get(firmwareId)
    if (!firmware) throw new RommError(t('error.biosGone'))

    const dir = dirFor.get(firmwareId)
    if (!dir) {
      // No target folder means the platform's row explained why, and that
      // explanation is far more useful than "cannot install".
      const row = report.platforms.find((platform) =>
        platform.items.some((item) => item.firmwareId === firmwareId)
      )
      throw new RommError(row?.blockedReason ?? t('error.biosNowhere'))
    }

    // The name is the server's, and it decides where the file is written. One
    // that climbs out of the BIOS folder is refused rather than followed.
    const destination = safeJoin(dir, firmware.file_name)
    if (!destination) {
      log.error('bios', 'refused a firmware name that leaves its folder', undefined, {
        firmwareId,
        fileName: firmware.file_name,
        dir
      })
      throw new RommError(t('error.unsafeName', { name: firmware.file_name }))
    }

    await mkdir(dir, { recursive: true })
    log.info('bios', 'installing a BIOS file', {
      firmwareId,
      fileName: firmware.file_name,
      sizeBytes: firmware.file_size_bytes,
      destination
    })
    // Copied exactly as the server holds it, archive or not: Eden's firmware
    // installer takes a zip as readily as a folder, and unpacking one here
    // would only turn a file RomMix can account for into several it cannot.
    await this.client.downloadFirmware(firmware, destination, (progress) =>
      // What RomM recorded when it scanned the file, where the response did not
      // carry a length: a bar with nothing to divide by cannot move at all.
      onProgress?.(progress.received, progress.total || firmware.file_size_bytes)
    )
    return destination
  }
}

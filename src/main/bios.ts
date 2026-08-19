import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { biosFor } from '@config/bios'
import { resolveSystem, systemLabel } from '@config/systems'
import type {
  BiosItem,
  BiosPlatform,
  BiosReport,
  BiosSyncResult,
  EmulatorState,
  RommFirmware,
  RommPlatform
} from '@shared/types'
import { RommClient, RommError } from './romm'
import type { Store } from './store'

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
  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    private readonly getEmulator: (system?: string) => EmulatorState | null
  ) {}

  /** The whole picture, one platform per row. */
  async report(): Promise<BiosReport> {
    return (await this.scan()).report
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
    const platforms = await this.client.platforms()

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
    // to refuse it for the rest.
    if (failures.length > 0) {
      throw new RommError(`Cannot read the BIOS files on the server: ${failures[0]}`)
    }

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
    const dirFor = new Map<number, string>()
    for (const platform of platforms) {
      const row = await this.describe(platform, byPlatform.get(platform.id) ?? [], listing)
      rows.push(row)
      if (row.biosDir) {
        for (const item of row.items) {
          if (item.firmwareId != null) dirFor.set(item.firmwareId, row.biosDir)
        }
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

    const present = biosDir ? await listing(biosDir) : new Set<string>()

    // Start from what the system is known to need, so a file the server does
    // not hold is still named — "PlayStation is missing scph5501.bin" is
    // actionable in a way that an empty list is not.
    const items = new Map<string, BiosItem>()
    for (const file of requirement?.files ?? []) {
      items.set(key(file.name), {
        fileName: file.name,
        note: file.note,
        required: file.required,
        installed: present.has(key(file.name)),
        firmwareId: null,
        sizeBytes: 0,
        verified: false
      })
    }

    // Then everything the server actually holds, which both fills in the ids
    // for the rows above and adds files RomMix has no expectations about.
    for (const item of firmware) {
      const existing = items.get(key(item.file_name))
      items.set(key(item.file_name), {
        fileName: item.file_name,
        note: existing?.note ?? null,
        required: existing?.required ?? false,
        installed: present.has(key(item.file_name)),
        firmwareId: item.id,
        sizeBytes: item.file_size_bytes,
        verified: item.is_verified
      })
    }

    const blockedReason = !system
      ? `RomMix has no folder mapping for ${platform.display_name}, so it does not know which ` +
        'emulator runs it. Add one in settings.systemOverrides.'
      : !emulator
        ? `No installed emulator runs ${systemLabel(system)}.`
        : !biosDir
          ? `RomMix does not know where ${emulator.name} keeps its BIOS files.`
          : null

    return {
      platformId: platform.id,
      platformSlug: platform.slug,
      platformName: platform.display_name,
      system,
      emulatorId: emulator?.id ?? null,
      emulatorName: emulator?.name ?? null,
      biosDir,
      items: [...items.values()].sort((a, b) => a.fileName.localeCompare(b.fileName)),
      blockedReason,
      dumpOnly: requirement?.dumpOnly ?? null
    }
  }

  /** Copy one firmware file from RomM into the emulator that needs it. */
  async install(firmwareId: number): Promise<string> {
    const { report, firmwareById, dirFor } = await this.scan()
    return this.place(firmwareId, firmwareById, dirFor, report)
  }

  /**
   * Install everything the server holds that is not already in place, for one
   * platform or for all of them.
   *
   * Failures are counted rather than thrown: one platform whose emulator is
   * missing should not stop the other thirty from being set up, and the count
   * is what the screen reports.
   */
  async syncAll(
    platformId?: number | null,
    onProgress?: (done: number, total: number) => void
  ): Promise<BiosSyncResult> {
    const { report, firmwareById, dirFor } = await this.scan()

    // Scoped by platform id rather than by the caller handing over a row: the
    // rows it is holding came from an earlier scan, and what is installed can
    // have changed since it drew them.
    const rows =
      platformId == null
        ? report.platforms
        : report.platforms.filter((row) => row.platformId === platformId)

    const pending = rows.flatMap((row) => row.items.filter((item) => !item.installed))
    const fetchable = pending.filter((item) => item.firmwareId != null)

    let installed = 0
    let failed = 0
    let done = 0

    for (const item of fetchable) {
      try {
        await this.place(item.firmwareId as number, firmwareById, dirFor, report)
        installed += 1
      } catch {
        failed += 1
      }
      done += 1
      onProgress?.(done, fetchable.length)
    }

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
    report: BiosReport
  ): Promise<string> {
    const firmware = firmwareById.get(firmwareId)
    if (!firmware) throw new RommError('That BIOS file is no longer on the server')

    const dir = dirFor.get(firmwareId)
    if (!dir) {
      // No target folder means the platform's row explained why, and that
      // explanation is far more useful than "cannot install".
      const row = report.platforms.find((platform) =>
        platform.items.some((item) => item.firmwareId === firmwareId)
      )
      throw new RommError(row?.blockedReason ?? 'RomMix has nowhere to put that BIOS file')
    }

    await mkdir(dir, { recursive: true })
    const destination = join(dir, firmware.file_name)
    await this.client.downloadFirmware(firmware, destination)
    return destination
  }
}

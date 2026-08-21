import { createWriteStream } from 'node:fs'
import { access, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { emulatorById } from '@config/emulators'
import type { CoreContext, EmulatorState, RequiredCore } from '@config/emulators'
import type { CoreProgress } from '@shared/api'
import { realHome } from './host'
import { fileSystemEnvironment } from './saveenv'
import { extractZip } from './zip'

/**
 * Installing the libretro core a game needs, before the game is started.
 *
 * This exists because of a gap nothing else closes. RetroArch is packaged
 * without cores — the Flathub build ships 291 core *info* files and not one
 * `.so` — and it does not fetch a missing one when asked to load it: given
 * `-L <core>` for a core that is not on disk it prints "path is not set",
 * calls that fatal, and exits before a window ever opens. From outside that is
 * indistinguishable from a crash, which is exactly what it looked like.
 *
 * The only thing that installs a core is a person walking RetroArch's Online
 * Updater menu, and a front end meant for a television is the last place that
 * can be asked of. So RomMix downloads the core from the same buildbot the
 * Online Updater uses, into the same directory it would have used.
 */

/** Where the buildbot publishes builds, by Node's name for the architecture. */
const BUILDBOT_ARCH: Readonly<Record<string, string>> = {
  x64: 'x86_64',
  arm64: 'arm64',
  arm: 'armv7-neon-hf'
}

/**
 * The buildbot directory to fetch from when no `retroarch.cfg` names one.
 *
 * Only reached on a RetroArch that has never been run — once it has, its own
 * config carries the right architecture and is preferred, because RetroArch
 * wrote it for the platform it is running on and RomMix's guess cannot be
 * better informed than that.
 */
function defaultBuildbotUrl(): string | null {
  const arch = BUILDBOT_ARCH[process.arch]
  if (!arch) return null
  return `https://buildbot.libretro.com/nightly/linux/${arch}/latest/`
}

/**
 * The archive holding one core.
 *
 * Forced to https even when the config says otherwise: RetroArch's default
 * `core_updater_buildbot_cores_url` is a plain-http address, and this
 * downloads a shared library that is about to be loaded into the emulator's
 * own process. The host serves both, so there is nothing to lose by insisting.
 */
function archiveUrl(core: RequiredCore): string | null {
  const base = core.buildbotUrl ?? defaultBuildbotUrl()
  if (!base) return null
  return `${base.replace(/^http:\/\//i, 'https://')}${core.fileName}.zip`
}

/** Is this core already where the emulator will look for it? */
export async function coreInstalled(core: RequiredCore): Promise<boolean> {
  return access(join(core.dir, core.fileName)).then(
    () => true,
    () => false
  )
}

/**
 * The core a launch needs, or null when nothing has to be installed.
 *
 * Null covers every ordinary case — an emulator that ships its own cores, a
 * system with no core mapped, a core already on disk — so a caller can treat a
 * non-null answer as "there is work to do here".
 */
export async function missingCore(
  emulator: EmulatorState,
  system: string
): Promise<RequiredCore | null> {
  const descriptor = emulatorById(emulator.id)
  if (!descriptor?.core) return null

  const context: CoreContext = {
    system,
    home: realHome(),
    configDir: emulator.configDir,
    env: fileSystemEnvironment()
  }

  let core: RequiredCore | null
  try {
    core = descriptor.core(context)
  } catch {
    // A descriptor that cannot answer is a bug, but not one worth turning into
    // a refused launch: the emulator may still start, and if it does not it
    // now fails with its own message rather than ours.
    return null
  }

  if (!core) return null
  return (await coreInstalled(core)) ? null : core
}

/**
 * Download a core and put it where the emulator loads cores from.
 *
 * The archive lands in the system temp directory rather than beside the core:
 * the cores directory is scanned by RetroArch for anything that looks like a
 * core, and a half-written file there is a worse failure than a failed
 * download — it makes the core look installed on the next launch, which would
 * skip this function and fail inside the emulator instead.
 */
export async function installCore(
  core: RequiredCore,
  onProgress: (progress: CoreProgress) => void
): Promise<void> {
  const url = archiveUrl(core)
  if (!url) {
    throw new Error(
      `No ${core.name} core is published for this machine. ` +
        `Install it from the emulator's own Online Updater.`
    )
  }

  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the ${core.name} core: ${url} responded ${response.status}`)
  }

  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0

  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress({ core: core.name, receivedBytes: received, totalBytes: total })
  })

  const archive = join(tmpdir(), `rommix-core-${core.id}-${process.pid}.zip`)
  try {
    await pipeline(body, createWriteStream(archive))
    await mkdir(core.dir, { recursive: true })
    await extractZip(archive, core.dir)
  } finally {
    await rm(archive, { force: true })
  }

  // The archive is expected to hold exactly the file the emulator will ask
  // for. Checking says so plainly here rather than letting a buildbot that
  // renamed something surface as the same fatal core error this replaced.
  if (!(await coreInstalled(core))) {
    throw new Error(`The ${core.name} download did not contain ${core.fileName}`)
  }
}

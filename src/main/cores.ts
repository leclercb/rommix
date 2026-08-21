import { createWriteStream } from 'node:fs'
import { access, copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { emulatorById } from '@config/emulators'
import type { CoreContext, EmulatorState, RequiredCore } from '@config/emulators'
import type { CoreProgress } from '@shared/api'
import { realHome } from './host'
import { log } from './log'
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

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

/** Is this core already where the emulator will look for it? */
export async function coreInstalled(core: RequiredCore): Promise<boolean> {
  return exists(join(core.dir, core.fileName))
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
  } catch (cause) {
    // A descriptor that cannot answer is a bug, but not one worth turning into
    // a refused launch: the emulator may still start, and if it does not it
    // now fails with its own message rather than ours.
    log.error('core', 'the emulator descriptor could not name a core', cause, {
      emulator: emulator.id,
      system
    })
    return null
  }

  if (!core) return null
  if (await coreInstalled(core)) {
    log.debug('core', 'already installed', { core: core.fileName, dir: core.dir })
    return null
  }
  log.info('core', 'missing and has to be installed before the launch', {
    core: core.fileName,
    name: core.name,
    dir: core.dir,
    system
  })
  return core
}

/**
 * Download a core and put it where the emulator loads cores from.
 *
 * Nothing incomplete is ever written into the cores directory. Both the
 * download and the extraction happen under the system temp directory, and only
 * a finished file is renamed into place — a rename within the same filesystem
 * being the one step that cannot half-happen.
 *
 * The alternative loses silently and permanently. A core left truncated where
 * the emulator looks is one that `coreInstalled` reports as present, so the
 * install is never retried; every future launch skips straight to the emulator,
 * which dies loading it. That is the exact failure this module exists to
 * remove, reintroduced in a form that no longer heals itself.
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

  log.info('core', 'downloading', { core: core.fileName, url })

  const response = await fetch(url)
  if (!response.ok || !response.body) {
    log.error('core', 'the buildbot refused the download', undefined, {
      url,
      status: response.status
    })
    throw new Error(`Could not download the ${core.name} core: ${url} responded ${response.status}`)
  }

  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0

  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress({ core: core.name, receivedBytes: received, totalBytes: total })
  })

  const staging = join(tmpdir(), `rommix-core-${core.id}-${process.pid}`)
  const archive = `${staging}.zip`
  // Beside the core rather than in the temp directory, because the last step
  // has to be a rename and a rename cannot cross filesystems — /tmp is
  // routinely a tmpfs while the cores live under the user's home. The suffix
  // keeps it from matching what the emulator scans for in the meantime.
  const partial = join(core.dir, `${core.fileName}.part`)

  try {
    await pipeline(body, createWriteStream(archive))
    await extractZip(archive, staging)

    // The archive is expected to hold exactly the file the emulator will ask
    // for. Checked before anything is put in place, so a buildbot that renamed
    // something fails here rather than as the fatal core error this replaced.
    const extracted = join(staging, core.fileName)
    if (!(await exists(extracted))) {
      throw new Error(`The ${core.name} download did not contain ${core.fileName}`)
    }

    await mkdir(core.dir, { recursive: true })
    await copyFile(extracted, partial)
    await rename(partial, join(core.dir, core.fileName))
    log.info('core', 'installed', {
      core: core.fileName,
      dir: core.dir,
      bytes: received
    })
  } finally {
    await rm(archive, { force: true })
    await rm(staging, { recursive: true, force: true })
    await rm(partial, { force: true })
  }
}

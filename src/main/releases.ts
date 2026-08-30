import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isInstallableAsset, type ReleaseSource } from '@config/emulators'
import type { EmulatorAsset, EmulatorInstallProgress, EmulatorRelease } from '@shared/types'
import { parseDigest, verifyDownload } from './integrity.ts'
import { log } from './log.ts'
import { rootPaths } from './root.ts'
import { extractZip, isZip } from './zip.ts'
import { t } from './i18n.ts'

/**
 * Installing an emulator that ships as a loose download rather than a package.
 *
 * Only the Forgejo/Gitea release shape is handled, which is what Eden
 * publishes. Distro packages and flatpaks need none of this — they are found
 * by `resolveInstall`, not fetched.
 */

/** Where RomMix keeps emulators it installed itself. */
export function managedEmulatorDir(id: string): string {
  // Inside RomMix's own root, so a whole installation is one movable folder.
  return join(rootPaths().emulators, id)
}

/**
 * Architecture tokens as they appear in a release asset's file name, keyed by
 * Node's name for the machine RomMix is running on.
 *
 * Eden publishes ten Linux AppImages per release — `amd64` and `aarch64`, plus
 * `legacy`, `rog-ally` and `steamdeck`, each in two flavours — and the pattern
 * in its descriptor matches every one of them. On x86_64 that puts two ARM
 * builds in the picker, and choosing one is not a visible mistake: the image
 * downloads, is made executable, and is recorded in `settings.emulatorPaths`,
 * after which the emulator reports itself installed and every launch dies with
 * an exec format error nothing on screen connects to the download.
 */
const ARCH_TOKENS: Readonly<Record<string, RegExp>> = {
  x64: /x86[_-]?64|amd64|\bx64\b/i,
  arm64: /aarch64|arm64/i,
  arm: /armv7|armhf/i
}

/**
 * Can this machine run that asset?
 *
 * By exclusion rather than by requirement: an asset naming a *different*
 * architecture is dropped, and one naming none is kept. shadPS4's Linux release
 * is `shadps4-linux-sdl-<date>-<sha>.zip`, with no architecture anywhere in the
 * name because only one is published — so a rule demanding a positive match
 * would leave that picker empty. Eden's builds do name theirs, which is the
 * case this exists for.
 */
export function builtForThisMachine(assetName: string): boolean {
  const mine = ARCH_TOKENS[process.arch]
  // An architecture RomMix has no token for cannot judge anything, and offering
  // every build beats offering none.
  if (!mine) return true
  if (mine.test(assetName)) return true
  return !Object.values(ARCH_TOKENS).some((pattern) => pattern.test(assetName))
}

/** Subset of the Forgejo release payload RomMix reads. */
interface ForgejoRelease {
  tag_name?: string
  name?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
  assets?: { name?: string; browser_download_url?: string; size?: number; digest?: string }[]
}

/**
 * List releases, keeping only assets that can actually be run *here* — the
 * right kind of file, and the right architecture.
 *
 * Releases whose asset list ends up empty are dropped: on Linux that is every
 * macOS/Windows-only or Android-only release, and on ARM every project that
 * ships x86_64 alone. Offering a version with nothing installable behind it is
 * just a dead end in the menu.
 */
export async function fetchReleases(source: ReleaseSource): Promise<EmulatorRelease[]> {
  // Both spellings, because the two hosts disagree and neither minds the other:
  // Forgejo reads `limit`, GitHub reads `per_page` and ignores `limit` — which
  // is why the shadPS4 list used to come back at GitHub's default page size
  // whatever this asked for. An unknown query parameter is discarded by both.
  const response = await fetch(`${source.api}?limit=20&per_page=20`, {
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    log.error('release', 'could not list releases', undefined, {
      api: source.api,
      status: response.status
    })
    throw new Error(t('error.releasesResponded', { api: source.api, status: response.status }))
  }

  const payload = (await response.json()) as ForgejoRelease[]

  return payload
    .filter((release) => !release.draft)
    .map((release) => {
      const assets: EmulatorAsset[] = (release.assets ?? [])
        .filter(
          (
            asset
          ): asset is {
            name: string
            browser_download_url: string
            size?: number
            digest?: string
          } =>
            typeof asset.name === 'string' &&
            typeof asset.browser_download_url === 'string' &&
            isInstallableAsset(asset.name, source) &&
            // Here rather than in the renderer, which has no `process.arch`.
            builtForThisMachine(asset.name)
        )
        .map((asset) => ({
          name: asset.name,
          url: asset.browser_download_url,
          sizeBytes: asset.size ?? 0,
          digest: parseDigest(asset.digest)
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      return {
        tag: release.tag_name ?? '',
        name: release.name ?? release.tag_name ?? '',
        prerelease: release.prerelease ?? false,
        publishedAt: release.published_at ?? null,
        assets
      }
    })
    .filter((release) => release.assets.length > 0)
}

/**
 * Download an asset into the managed directory and make it executable.
 *
 * The file lands under a temporary name and is renamed once complete, so an
 * interrupted download can never be left looking like a working emulator.
 * Anything previously installed for this emulator is removed first: these are
 * whole-application images, and keeping several versions would only leave
 * auto-discovery guessing between them.
 */
export async function installAsset(
  emulatorId: string,
  asset: EmulatorAsset,
  onProgress: (progress: EmulatorInstallProgress) => void
): Promise<string> {
  const dir = managedEmulatorDir(emulatorId)
  /**
   * The new install is assembled beside the old one, never on top of it.
   *
   * Clearing the directory first made the download the only copy in existence
   * for as long as it took: a refused request, a connection that broke, a
   * digest that did not match, or the machine losing power left the user with
   * no emulator at all — having pressed a button that offered to update one
   * that worked.
   *
   * A sibling rather than a temporary directory, because the last step is a
   * rename and a rename cannot cross filesystems. Anything a previous attempt
   * left here goes first; it is a scratch directory and nothing reads it.
   */
  const staging = `${dir}.incoming`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  const destination = join(staging, asset.name)
  const partial = `${destination}.part`

  const response = await fetch(asset.url)
  if (!response.ok || !response.body) {
    log.error('release', 'the download was refused', undefined, {
      url: asset.url,
      status: response.status
    })
    throw new Error(t('error.assetDownloadFailed', { url: asset.url, status: response.status }))
  }

  const declared = Number(response.headers.get('content-length') ?? 0)
  let received = 0

  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress({
      emulatorId,
      assetName: asset.name,
      receivedBytes: received,
      // The release API reports size 0 for these assets, so the response
      // header is the only honest total available.
      totalBytes: declared || asset.sizeBytes
    })
  })

  try {
    await pipeline(body, createWriteStream(partial))
  } catch (cause) {
    log.error('release', 'the download broke off part-way', cause, {
      emulator: emulatorId,
      asset: asset.name,
      received
    })
    await rm(staging, { recursive: true, force: true })
    throw cause
  }
  log.info('release', 'asset downloaded', { emulator: emulatorId, asset: asset.name, received })

  // Before it is made executable, and before it has the name the probe looks
  // for: an emulator is a program this machine is about to run, so the check
  // belongs ahead of anything that makes it runnable.
  try {
    await verifyDownload(partial, asset.digest, { kind: 'emulator', name: asset.name })
  } catch (cause) {
    // The staging directory goes with it. The install that is already there is
    // untouched, which is the whole point of building beside it.
    await rm(staging, { recursive: true, force: true })
    throw cause
  }

  // Executable before the rename, so the finished name never exists in a state
  // where it looks installed but cannot be run.
  await chmod(partial, 0o755)
  await rename(partial, destination)

  // By its magic bytes rather than its name: what matters is whether the file
  // is an archive, not what the project chose to call it.
  const built = (await isZip(destination)) ? await unpackImage(destination, staging) : destination

  /**
   * The swap, and the only moment the old install is not there.
   *
   * Two renames rather than one: the previous directory is moved aside before
   * the new one takes its place, so the window where neither is in position is
   * as short as the kernel can make it, and a failure part-way leaves the old
   * one recoverable under a name nothing else uses.
   */
  const previous = `${dir}.previous`
  await rm(previous, { recursive: true, force: true })
  if (existsSync(dir)) await rename(dir, previous)
  await rename(staging, dir)
  await rm(previous, { recursive: true, force: true })

  log.info('release', 'the new install is in place', {
    emulator: emulatorId,
    asset: asset.name,
    dir
  })
  // Named in the directory it now lives in rather than the one it was built in.
  return join(dir, relative(staging, built))
}

/**
 * Take the program out of a downloaded archive.
 *
 * Not every project publishes the image itself: shadPS4's Linux release is a
 * zip with one `.AppImage` inside it. Unpacking here rather than teaching the
 * probe to look inside archives keeps the managed directory holding what it
 * claims to — a program that can be run — and is what makes a zipped release
 * indistinguishable from a plain one everywhere else.
 *
 * The archive is removed once its contents are out, so nothing is left for
 * auto-discovery to find twice.
 */
async function unpackImage(archive: string, dir: string): Promise<string> {
  await extractZip(archive, dir)
  await rm(archive, { force: true })

  const image = (await readdir(dir)).find((name) => name.toLowerCase().endsWith('.appimage'))
  if (!image) {
    throw new Error(t('error.noAppImageInArchive', { archive: basename(archive) }))
  }

  const path = join(dir, image)
  await chmod(path, 0o755)
  return path
}

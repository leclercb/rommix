import { createWriteStream } from 'node:fs'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isInstallableAsset, type ReleaseSource } from '@shared/emulators'
import type { EmulatorAsset, EmulatorInstallProgress, EmulatorRelease } from '@shared/types'
import { rootPaths } from './root'

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
  // It must also be a real host path, because the emulator is spawned on the
  // host and a sandbox-only path would not exist there.
  return join(rootPaths().emulators, id)
}

/** Subset of the Forgejo release payload RomMix reads. */
interface ForgejoRelease {
  tag_name?: string
  name?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
  assets?: { name?: string; browser_download_url?: string; size?: number }[]
}

/**
 * List releases, keeping only assets that can actually be run.
 *
 * Releases whose asset list ends up empty are dropped: on Linux that is every
 * macOS/Windows-only or Android-only release, and offering a version with
 * nothing to install behind it is just a dead end in the menu.
 */
export async function fetchReleases(source: ReleaseSource): Promise<EmulatorRelease[]> {
  const response = await fetch(`${source.api}?limit=20`, {
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(`${source.api} responded ${response.status}`)
  }

  const payload = (await response.json()) as ForgejoRelease[]

  return payload
    .filter((release) => !release.draft)
    .map((release) => {
      const assets: EmulatorAsset[] = (release.assets ?? [])
        .filter(
          (asset): asset is { name: string; browser_download_url: string; size?: number } =>
            typeof asset.name === 'string' &&
            typeof asset.browser_download_url === 'string' &&
            isInstallableAsset(asset.name, source.assetSuffix)
        )
        .map((asset) => ({
          name: asset.name,
          url: asset.browser_download_url,
          sizeBytes: asset.size ?? 0
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
  onProgress: (progress: EmulatorInstallProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const dir = managedEmulatorDir(emulatorId)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const destination = join(dir, asset.name)
  const partial = `${destination}.part`

  const response = await fetch(asset.url, { signal })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${asset.url} responded ${response.status}`)
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
    await rm(partial, { force: true })
    throw cause
  }

  // Executable before the rename, so the finished name never exists in a state
  // where it looks installed but cannot be run.
  await chmod(partial, 0o755)
  await rename(partial, destination)
  return destination
}

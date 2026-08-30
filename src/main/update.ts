import { app } from 'electron'
import { createWriteStream } from 'node:fs'
import { chmod, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdatePolicy, UpdateStatus } from '@shared/types'
import { parseDigest, verifyDownload, type Digest } from './integrity.ts'
import { log } from './log.ts'
// The architecture predicate, which is about this machine rather than about
// emulators — RomMix publishes an x86_64 and an arm64 image per release, and
// the rule for telling them apart is the one already written there.
import { builtForThisMachine } from './releases.ts'
import type { Store } from './store.ts'
import { t } from './i18n.ts'

/**
 * RomMix updating itself.
 *
 * An AppImage has nobody to update it. It is one file the user downloaded, with
 * no package manager behind it and no repository to pull from, so a copy that is
 * not told about a release stays on the version it was fetched at — which for a
 * program that talks to a moving API and drives six emulators is how an
 * installation quietly rots. This is the part that tells it.
 *
 * The mechanism is the same one `releases.ts` uses for emulators — read the
 * project's releases, pick the asset built for this machine, stream it to disk —
 * with one difference that matters: the file being replaced is the one currently
 * running. That is safe on Linux and only on Linux's terms. The image is
 * *renamed into place*, never written over: the running program holds the old
 * inode open (through the FUSE mount, or through the copy extract-and-run left
 * in /tmp), and a rename swaps the directory entry without touching it. The old
 * file is unlinked afterwards, which frees the name and not the bytes.
 *
 * Nothing restarts on its own. The new image is put in place and the version in
 * memory carries on running until the user quits, which is the only moment where
 * a swap costs nobody a game in progress.
 */

/** RomMix's own releases. `/latest` is the newest non-draft, non-prerelease. */
const RELEASE_API = 'https://api.github.com/repos/leclercb/rommix/releases/latest'

/** Where to send someone whose copy cannot replace itself. */
export const RELEASES_PAGE = 'https://github.com/leclercb/rommix/releases'

/**
 * How long after start the first check waits, and how often it repeats.
 *
 * The delay is not politeness about bandwidth — it is about what start-up is
 * for: the library load, the emulator probe and the window appearing get those
 * first moments to themselves, and a release check is worth none of them. It
 * stays short enough that a new version is announced while the shelf is still
 * being read. The repeat is a compromise between a handheld that is woken for
 * an hour a day and a machine in a living room that is never shut down.
 */
const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** Progress is emitted on a clock rather than per chunk: this is a 100 MB file. */
const PROGRESS_EVERY_MS = 250

/** The subset of GitHub's release payload RomMix reads. */
interface GithubRelease {
  tag_name?: string
  body?: string
  html_url?: string
  assets?: { name?: string; browser_download_url?: string; size?: number; digest?: string }[]
}

/** One downloadable file from a release. */
export interface UpdateAsset {
  name: string
  url: string
  sizeBytes: number
  /** What GitHub says it published, or null on a release predating the field. */
  digest: Digest | null
}

/**
 * Compare two versions, semver's way: negative when `a` is older.
 *
 * Written here rather than taken from a package because RomMix has three
 * dependencies and this is thirty lines. The rules that earn those lines are the
 * two that string comparison gets wrong: `0.10.0` is newer than `0.9.9`, and
 * `1.0.0-rc1` is *older* than `1.0.0` — which is the difference between offering
 * a release candidate to everyone and offering it to nobody.
 */
export function compareVersions(a: string, b: string): number {
  const parsed = (value: string): { core: number[]; pre: string[] } => {
    // Build metadata (`+abc`) is explicitly not part of precedence, and the
    // leading `v` is how the tags are written but not how package.json is.
    const clean = value.trim().replace(/^v/i, '').split('+')[0]
    const dash = clean.indexOf('-')
    const core = (dash < 0 ? clean : clean.slice(0, dash)).split('.')
    return {
      core: [0, 1, 2].map((index) => Number.parseInt(core[index] ?? '0', 10) || 0),
      pre: dash < 0 ? [] : clean.slice(dash + 1).split('.')
    }
  }

  const left = parsed(a)
  const right = parsed(b)

  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index]
  }

  // A version with no pre-release part is the finished one, and finished beats
  // any candidate for it.
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1

  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const one = left.pre[index]
    const two = right.pre[index]
    // `rc.1` against `rc.1.1`: whoever ran out of identifiers first is older.
    if (one === undefined) return -1
    if (two === undefined) return 1
    if (one === two) continue

    const oneNumeric = /^\d+$/.test(one)
    const twoNumeric = /^\d+$/.test(two)
    // Numerically where both are numbers, so `rc.10` beats `rc.2`; a numeric
    // identifier ranks below an alphanumeric one, which is semver's rule.
    if (oneNumeric && twoNumeric) return Number(one) - Number(two)
    if (oneNumeric) return -1
    if (twoNumeric) return 1
    return one < two ? -1 : 1
  }

  return 0
}

/**
 * The image from a release that this machine can run, or null.
 *
 * `.AppImage` and nothing else: a release also carries `rommix-steam.sh`, which
 * is a launcher for the image and not a copy of RomMix. The architecture rule is
 * shared with the emulator installer, so an arm64 handheld is never offered the
 * x86_64 build — an image that is downloaded, made executable and dies with an
 * exec format error is a far worse outcome than being told there is no build.
 */
export function pickImage(assets: readonly UpdateAsset[]): UpdateAsset | null {
  return (
    assets.find((asset) => /\.appimage$/i.test(asset.name) && builtForThisMachine(asset.name)) ??
    null
  )
}

/**
 * Whether Steam started RomMix, and therefore owns the process.
 *
 * Steam launches a game through its reaper, which watches the process it
 * started and cleans up everything left behind when that process exits. An
 * Electron relaunch is exactly that shape — spawn a detached child, exit — so
 * under Steam the new RomMix is either killed with the rest of the session or
 * survives untracked, which under gamescope means a window Steam never tagged
 * and nothing can focus. Either way the user pressed a button and lost their
 * screen.
 *
 * `SteamGameId` and `SteamAppId` are set for every launch Steam makes, non-Steam
 * shortcuts included — which is what RomMix is added as.
 */
function startedBySteam(): boolean {
  return Boolean(process.env.SteamGameId ?? process.env.SteamAppId)
}

/** The status a run starts with: what is running, and nothing else known yet. */
function initialStatus(): UpdateStatus {
  return {
    state: 'idle',
    current: app.getVersion(),
    latest: null,
    notes: null,
    url: null,
    receivedBytes: 0,
    totalBytes: 0,
    readyPath: null,
    blockedReason: null,
    // Decided once, at start: how RomMix was launched cannot change under it.
    restartBlocked: startedBySteam() ? t('update.steamBlocked') : null,
    error: null,
    checkedAt: null
  }
}

export class Updater {
  private readonly store: Store
  private readonly emit: (status: UpdateStatus) => void

  private current: UpdateStatus = initialStatus()
  /**
   * The asset the last check found, held back from the status on purpose: the
   * renderer has no use for a URL it never fetches itself.
   */
  private pending: UpdateAsset | null = null
  /** One check or download at a time, whoever asked for it. */
  private busy = false
  /** The delayed first check, and the one that repeats. See `schedule`. */
  private first: NodeJS.Timeout | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(store: Store, emit: (status: UpdateStatus) => void) {
    this.store = store
    this.emit = emit
  }

  get status(): UpdateStatus {
    return this.current
  }

  private policy(): UpdatePolicy {
    return this.store.settings.updates
  }

  /**
   * Start (or stop) checking on a timer, according to the setting.
   *
   * Called once at start-up and again whenever the preference changes, so
   * turning checks on does not wait for a restart to take effect.
   */
  schedule(): void {
    // Whatever was pending is dropped first: this is called again on every
    // change of the setting, and three visits to the segmented control must not
    // leave three checks queued.
    this.stop()
    if (this.policy() === 'off') {
      log.info('update', 'automatic checks are off')
      return
    }

    log.info('update', 'checking for new versions', {
      policy: this.policy(),
      current: this.current.current,
      everyHours: CHECK_EVERY_MS / 3_600_000
    })

    const tick = (): void => {
      void this.check().catch(() => {
        // `check` records its own failure; this only keeps a network that is
        // down from becoming an unhandled rejection every six hours.
      })
    }

    // `unref` on both: a timer is not a reason for the process to stay alive,
    // and a pending check must never hold up a quit.
    this.first = setTimeout(tick, FIRST_CHECK_MS)
    this.first.unref()
    this.timer = setInterval(tick, CHECK_EVERY_MS)
    this.timer.unref()
  }

  /** Stop checking. For a quit, so nothing fires into a closing window. */
  stop(): void {
    if (this.first) {
      clearTimeout(this.first)
      this.first = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Ask GitHub what the newest release is.
   *
   * Under `auto` the download follows, started once this has finished rather
   * than awaited: the question here is "is there something new", which is
   * settled the moment the release is read, and a caller that waited would sit
   * through a hundred megabytes to learn a version number it already had.
   */
  async check(): Promise<UpdateStatus> {
    if (this.busy) return this.current
    // An image already staged ends the subject until RomMix is restarted.
    // Without this the six-hourly check would find the same release it has
    // already fetched — the running version does not change when the file
    // does — and download it again, every six hours, forever.
    if (this.current.state === 'ready') return this.current
    this.busy = true
    this.update({ state: 'checking', error: null })

    /** Set inside, acted on outside — `download` refuses while `busy` holds. */
    let fetchIt = false

    try {
      const response = await fetch(RELEASE_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          // GitHub refuses an anonymous request with no agent, and an honest one
          // is what makes RomMix's share of the rate limit attributable.
          'User-Agent': `RomMix/${this.current.current}`
        }
      })
      if (!response.ok) {
        throw new Error(t('update.githubResponded', { status: response.status }))
      }

      const release = (await response.json()) as GithubRelease
      const latest = (release.tag_name ?? '').replace(/^v/i, '')
      if (!latest) throw new Error(t('update.noVersionTag'))

      const checkedAt = new Date().toISOString()
      const newer = compareVersions(latest, this.current.current) > 0

      if (!newer) {
        log.info('update', 'already on the newest version', {
          current: this.current.current,
          latest
        })
        this.pending = null
        this.update({
          state: 'idle',
          latest,
          checkedAt,
          url: release.html_url ?? RELEASES_PAGE,
          // Notes belong to a version that is no longer news. The block, on the
          // other hand, is a fact about this installation and worth stating
          // before there is an update it would stop — which is why it is
          // computed here too and not only when there is something to fetch.
          notes: null,
          blockedReason: this.blockedReason()
        })
        return this.current
      }

      const assets: UpdateAsset[] = (release.assets ?? [])
        .filter(
          (
            asset
          ): asset is {
            name: string
            browser_download_url: string
            size?: number
            digest?: string
          } => typeof asset.name === 'string' && typeof asset.browser_download_url === 'string'
        )
        .map((asset) => ({
          name: asset.name,
          url: asset.browser_download_url,
          sizeBytes: asset.size ?? 0,
          digest: parseDigest(asset.digest)
        }))

      this.pending = pickImage(assets)
      // Two separate reasons a release cannot be installed here — no build for
      // this architecture, and a copy of RomMix that cannot replace itself —
      // and the version is still reported either way, with the page to get it
      // from. Being told a release exists is worth something even when the last
      // step has to be done by hand.
      const blockedReason = this.pending
        ? this.blockedReason()
        : t('update.noBuildForMachine', { version: latest, arch: process.arch })

      log.info('update', 'a newer version is published', {
        current: this.current.current,
        latest,
        asset: this.pending?.name ?? null,
        blockedReason
      })

      this.update({
        state: 'available',
        latest,
        checkedAt,
        notes: notesOf(release.body),
        url: release.html_url ?? RELEASES_PAGE,
        blockedReason,
        receivedBytes: 0,
        totalBytes: this.pending?.sizeBytes ?? 0
      })

      fetchIt = this.policy() === 'auto' && !blockedReason
      return this.current
    } catch (cause) {
      log.error('update', 'could not check for a new version', cause, { api: RELEASE_API })
      this.update({ state: 'error', error: (cause as Error).message })
      return this.current
    } finally {
      this.busy = false
      // After the flag is cleared and after the value has been returned, which
      // is what lets the download take the lock this call was holding.
      if (fetchIt) {
        void this.download().catch(() => {
          // `download` records and reports its own failure.
        })
      }
    }
  }

  /**
   * Fetch the new image and put it where the running one is.
   *
   * It lands under a `.part` name and is renamed onto the running image once
   * complete, so an interrupted download can never be mistaken for a working
   * RomMix — the same rule the emulator installer follows, for the same reason.
   *
   * **The path never changes**, which is the whole design and not a shortcut
   * taken here. RomMix is a program people wire into other things: a Steam
   * shortcut aimed at the image, a desktop entry written by AppImageLauncher, a
   * `ROMMIX_APPIMAGE` in a launch script. None of those is updated by us, and
   * each would fail as a game that no longer starts, on a television, with
   * nothing on screen to explain it. So the release is published as
   * `RomMix-x86_64.AppImage` with no version in the name — see
   * `appImage.artifactName` in electron-builder.yml — and updating writes over
   * that file. Nothing is renamed, nothing is left behind, and the name is never
   * out of date because it never claimed a version in the first place.
   */
  async download(): Promise<UpdateStatus> {
    // A check is running, or another download is: either way this one has
    // nothing to add, and under `auto` the check in progress starts it anyway.
    if (this.busy) return this.current

    const asset = this.pending
    if (!asset) throw new Error(t('update.nothingToDownload'))

    const blocked = this.blockedReason()
    if (blocked) throw new Error(blocked)

    // Read after `blockedReason`, which is what establishes that it is set.
    const running = process.env.APPIMAGE as string
    // Beside the image rather than in /tmp: a rename is atomic only within one
    // filesystem, and /tmp is very often another one — which would turn the
    // final step into a copy, over the file being replaced, with no way back if
    // it stopped half-way.
    const partial = `${running}.part`

    this.busy = true
    this.update({ state: 'downloading', error: null, receivedBytes: 0 })

    try {
      log.info('update', 'downloading a new version', {
        version: this.current.latest,
        asset: asset.name,
        url: asset.url,
        destination: running
      })

      const response = await fetch(asset.url)
      if (!response.ok || !response.body) {
        throw new Error(t('update.downloadFailed', { url: asset.url, status: response.status }))
      }

      const declared = Number(response.headers.get('content-length') ?? 0)
      let received = 0
      let announced = 0

      const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
      body.on('data', (chunk: Buffer) => {
        received += chunk.length
        const now = Date.now()
        if (now - announced < PROGRESS_EVERY_MS) return
        announced = now
        this.update({ receivedBytes: received, totalBytes: declared || asset.sizeBytes })
      })

      await pipeline(body, createWriteStream(partial))

      // Before it is made executable, let alone before it is put in place: this
      // is the one download that becomes the program doing the downloading, so
      // it is the last thing that should be taken on trust. A mismatch deletes
      // the part-file and fails the update, leaving the running version alone.
      await verifyDownload(partial, asset.digest, { kind: 'update', name: asset.name })

      // Executable before the rename, so the path never exists in a state where
      // it looks like RomMix and cannot be run.
      await chmod(partial, 0o755)
      // The swap, and the whole reason this is written as a rename: the running
      // program is holding the old inode open — through the FUSE mount, or
      // through the copy extract-and-run left in /tmp — and rename replaces the
      // directory entry without touching it. The session carries on as if
      // nothing happened, on bytes that no longer have a name.
      await rename(partial, running)

      log.info('update', 'the new version is in place', {
        version: this.current.latest,
        path: running,
        bytes: received
      })
      this.update({
        state: 'ready',
        readyPath: running,
        receivedBytes: received,
        totalBytes: declared || asset.sizeBytes || received
      })
      return this.current
    } catch (cause) {
      log.error('update', 'the download failed', cause, { asset: asset.name })
      await rm(partial, { force: true })
      const failure = new Error(explain(cause, dirname(running)))
      this.update({ state: 'error', error: failure.message })
      throw failure
    } finally {
      this.busy = false
    }
  }

  /**
   * Restart into the version already on disk.
   *
   * `execPath` is the image rather than Electron's own: `process.execPath` is
   * the binary *inside* the AppImage, at the mount point this session unpacked —
   * still there, still the old version, and still running from the inode the new
   * file replaced. Relaunching the default way would start 0.5.1 again and look
   * like an update that did not take.
   */
  restart(): void {
    if (this.current.state !== 'ready' || !this.current.readyPath) {
      throw new Error(t('update.nothingToRestartInto'))
    }
    // The interface offers Quit instead where this is set, so reaching here is
    // a caller that ignored it rather than a user who pressed the wrong thing.
    if (this.current.restartBlocked) throw new Error(this.current.restartBlocked)
    log.info('update', 'restarting into the new version', {
      version: this.current.latest,
      path: this.current.readyPath
    })
    app.relaunch({ execPath: this.current.readyPath })
    app.exit(0)
  }

  /**
   * Why this copy cannot replace itself, or null when it can.
   *
   * `APPIMAGE` is the AppImage runtime's own statement of which file it started
   * from — set for a normal run and for the extract-and-run path
   * `rommix-steam.sh` takes, and absent for `npm run dev` and for an unpacked
   * `electron-builder --linux dir` build.
   */
  private blockedReason(): string | null {
    if (process.env.APPIMAGE) return null
    if (!app.isPackaged) {
      return t('update.devBuild')
    }
    return t('update.notAppImage')
  }

  /** Fold a change into the status and tell the interface. */
  private update(patch: Partial<UpdateStatus>): void {
    this.current = { ...this.current, ...patch }
    this.emit(this.current)
  }
}

/**
 * A failed download in words, where the errno says something worth saying.
 *
 * The two that are not RomMix's fault and not the network's are worth naming:
 * an image kept somewhere its owner cannot write — `/opt`, or a folder that
 * belongs to root — and a disk with nothing left on it. Both otherwise arrive as
 * `EACCES: permission denied, open '/opt/RomMix-0.6.0-x86_64.AppImage.part'`,
 * which says where but never what to do.
 */
function explain(cause: unknown, dir: string): string {
  const code = (cause as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return t('update.cannotWrite', { dir })
  }
  if (code === 'ENOSPC') {
    return t('update.noRoom', { dir })
  }
  return (cause as Error).message
}

/**
 * The release notes, trimmed to something a television can show.
 *
 * GitHub's generated notes end with a full changelog and a compare link, which
 * on a 10-foot screen is a wall of commit subjects and a URL nobody can click.
 * The first paragraphs are the part written for a reader.
 */
function notesOf(body: string | undefined): string | null {
  const text = (body ?? '').trim()
  if (!text) return null
  return text.length > 1200 ? `${text.slice(0, 1200).trimEnd()}…` : text
}

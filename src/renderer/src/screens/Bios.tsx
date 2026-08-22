import { type JSX, useCallback, useEffect, useState } from 'react'
import type { BiosPlatform, BiosReport } from '@shared/types'
import { FocusButton, Hints, Overlay, PlatformIcon, Spinner, formatBytes } from '../components'
import { useApp, type ToastSubject } from '../state'

/**
 * BIOS files, per platform.
 *
 * The whole screen exists because "the game does not start" is the least
 * informative failure in emulation, and a missing BIOS is one of its most
 * common causes. So it names three things that are otherwise invisible: which
 * files a platform needs, which of those the RomM server actually holds, and
 * whether the emulator now running that platform already has them.
 *
 * Nothing is fetched from the internet. A BIOS comes from the user's own RomM
 * server or not at all, and a file the server does not hold is reported as
 * something to upload rather than something RomMix could find.
 */
export function BiosScreen(): JSX.Element {
  const { notify } = useApp()
  const [report, setReport] = useState<BiosReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setReport(await window.rommix.bios.list())
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [])

  /**
   * The Re-check button: the same load, with an answer.
   *
   * Silent before, which on a machine where nothing had changed was
   * indistinguishable from a button that does nothing — the identical list,
   * redrawn. What the check *concluded* is the part worth saying, so the
   * notification is the count rather than "done".
   */
  const recheck = async (): Promise<void> => {
    setRechecking(true)
    try {
      const next = await window.rommix.bios.list()
      setReport(next)
      setError(null)
      const outstanding = next.platforms.reduce(
        (count, platform) => count + platform.items.filter((item) => !item.installed).length,
        0
      )
      notify(
        outstanding === 0
          ? 'Checked — every BIOS file is in place'
          : `Checked — ${outstanding} file${outstanding === 1 ? '' : 's'} still missing`,
        outstanding === 0 ? 'ok' : 'warn'
      )
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setRechecking(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => window.rommix.bios.onProgress(setProgress), [])

  /**
   * Which console a notification is about, in the shape the toast wants.
   *
   * A BIOS file name says nothing on its own — `scph5501.bin` and `bios7.bin`
   * are equally opaque unless you already know them — so every notification
   * from this screen names the system and shows its icon.
   */
  const subject = (platform: BiosPlatform): ToastSubject => ({
    title: platform.platformName,
    platform: { slug: platform.platformSlug, system: platform.system }
  })

  const install = async (
    firmwareId: number,
    fileName: string,
    platform: BiosPlatform
  ): Promise<void> => {
    setBusy(fileName)
    try {
      await window.rommix.bios.install(firmwareId)
      notify(`${fileName} installed`, 'ok', subject(platform))
      await load()
    } catch {
      // Announced by the main process on `app:error`; this only stops the
      // "installed" notification from firing on a failure.
    } finally {
      setBusy(null)
    }
  }

  /** Install everything outstanding, for one platform or for all of them. */
  const syncAll = async (platform?: BiosPlatform): Promise<void> => {
    setBusy(platform ? `platform:${platform.platformId}` : 'all')
    setProgress(null)
    try {
      const result = await window.rommix.bios.syncAll(platform?.platformId)
      const parts = [`${result.installed} installed`]
      if (result.failed > 0) parts.push(`${result.failed} failed`)
      if (result.unavailable > 0) parts.push(`${result.unavailable} not on the server`)
      notify(
        parts.join(' · '),
        result.failed > 0 ? 'warn' : 'ok',
        platform ? subject(platform) : undefined
      )
      await load()
    } catch {
      // Reported centrally; the overlay still has to come down.
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  if (error) {
    return (
      <div className="content">
        <h1 className="page-title">BIOS</h1>
        <div className="notice notice--error">{error}</div>
        <div className="btn-row">
          {/* The same call the Re-check button makes, so a retry that works
              says so — otherwise a second failure redraws an identical error
              and the button looks inert. */}
          <FocusButton
            icon="refresh"
            onSelect={() => void recheck()}
            disabled={rechecking}
            autoFocus
          >
            {rechecking ? 'Trying…' : 'Try again'}
          </FocusButton>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="content">
        <h1 className="page-title">BIOS</h1>
        <Spinner />
      </div>
    )
  }

  const missing = report.platforms.reduce(
    (count, platform) => count + platform.items.filter((item) => !item.installed).length,
    0
  )
  const fetchable = report.platforms.reduce(
    (count, platform) =>
      count + platform.items.filter((item) => !item.installed && item.firmwareId != null).length,
    0
  )

  return (
    <div className="content">
      <h1 className="page-title">BIOS</h1>
      <p className="page-subtitle">
        {missing === 0
          ? 'Every BIOS file RomMix knows about is in place.'
          : `${missing} file${missing === 1 ? '' : 's'} missing, ${fetchable} of them on your RomM server`}
      </p>
      <p className="faint" style={{ fontSize: 14 }}>
        BIOS files come from your own RomM server — upload them there under a platform, and RomMix
        copies them into whichever emulator runs that platform. Nothing is downloaded from anywhere
        else.
      </p>

      <div className="btn-row">
        <FocusButton
          icon="install"
          variant="primary"
          onSelect={() => void syncAll()}
          disabled={busy !== null || fetchable === 0}
          autoFocus
        >
          {fetchable === 0 ? 'Nothing to install' : 'Install all'}
        </FocusButton>
        <FocusButton
          icon="refresh"
          onSelect={() => void recheck()}
          disabled={busy !== null || rechecking}
        >
          {rechecking ? 'Checking…' : 'Re-check'}
        </FocusButton>
      </div>

      {report.platforms.length === 0 ? (
        <div className="empty">No platforms on your RomM server yet.</div>
      ) : (
        report.platforms.map((platform) => (
          <PlatformBios
            key={platform.platformId}
            platform={platform}
            busy={busy}
            onInstall={install}
            onInstallAll={syncAll}
          />
        ))
      )}

      {busy === 'all' || busy?.startsWith('platform:') ? (
        <Overlay title="Installing BIOS files">
          <p className="muted">
            {progress ? `${progress.done} of ${progress.total}` : 'Working out what is missing…'}
          </p>
          <Spinner />
        </Overlay>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: 'Install' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}

function PlatformBios({
  platform,
  busy,
  onInstall,
  onInstallAll
}: {
  platform: BiosPlatform
  busy: string | null
  onInstall: (firmwareId: number, fileName: string, platform: BiosPlatform) => void
  onInstallAll: (platform: BiosPlatform) => void
}): JSX.Element | null {
  // A platform with nothing needed, nothing on the server and no problem to
  // report has nothing to say. Showing it anyway would bury the handful that
  // matter under thirty rows of "fine".
  if (platform.items.length === 0 && !platform.setupNote && !platform.blockedReason) return null

  const outstanding = platform.items.filter((item) => !item.installed).length

  /**
   * What this row can honestly claim.
   *
   * "Ready" is a statement about a check that happened and passed, not about an
   * empty list of complaints — and three things produce an empty list without
   * anything having been checked. A platform RomMix has no folder for was never
   * looked at. A platform carrying a `setupNote` needs something the file list
   * cannot describe — keys, a NAND image — so RomMix cannot tell a set-up
   * console from an empty folder. And a platform with no known requirement and nothing on the server
   * has no files to have an opinion about.
   *
   * All three are "unknown", and each has its reason spelled out in the notice
   * directly below this heading. Calling them ready is the one answer that
   * stops the user looking — which is exactly the wrong outcome for a console
   * whose BIOS is, in fact, not installed.
   */
  const status: { label: string; state: 'ok' | 'warn' | 'off' } =
    platform.biosDir === null
      ? { label: 'Unknown', state: 'off' }
      : outstanding > 0
        ? { label: `${outstanding} missing`, state: 'warn' }
        : platform.setupNote || platform.items.length === 0
          ? { label: 'Unknown', state: 'off' }
          : { label: 'Ready', state: 'ok' }
  // What this console alone can be given now: the button is about this section,
  // so a file the server does not hold must not be counted into it.
  const fetchable = platform.items.filter(
    (item) => !item.installed && item.firmwareId != null
  ).length

  return (
    <section className="bios">
      <h2 className="section-title bios__title">
        <PlatformIcon
          slug={platform.platformSlug}
          system={platform.system}
          size={28}
          label={platform.platformName}
        />
        {platform.platformName}
        <span className="status" data-state={status.state}>
          {status.label}
        </span>
        {/* Only where it can do something: a console that is ready, or whose
            missing files are not on the server, would offer a button that
            installs nothing. */}
        {fetchable > 0 ? (
          <span className="bios__install-all">
            <FocusButton
              icon="install"
              variant="ghost"
              onSelect={() => onInstallAll(platform)}
              disabled={busy !== null || platform.biosDir === null}
            >
              Install all
            </FocusButton>
          </span>
        ) : null}
      </h2>

      <div className="bios__where">
        {platform.emulatorName && platform.biosDir
          ? `${platform.emulatorName} · ${platform.biosDir}`
          : null}
      </div>

      {platform.blockedReason ? (
        <div className="notice notice--warn">{platform.blockedReason}</div>
      ) : null}
      {platform.setupNote ? <div className="notice notice--warn">{platform.setupNote}</div> : null}
      {/* Files RomMix can fetch but not install: it says where it put them and
          what the user has to do with them. */}
      {platform.stagingNote ? (
        <div className="notice notice--warn">{platform.stagingNote}</div>
      ) : null}

      {platform.items.map((item) => (
        <div className="bios__item" key={item.fileName}>
          <div className="bios__body">
            <div className="bios__name">
              {item.fileName}
              <span
                className="status"
                data-state={item.installed ? 'ok' : item.required ? 'warn' : 'off'}
              >
                {item.installed ? 'Installed' : item.required ? 'Required' : 'Optional'}
              </span>
              {/* RomM checks uploads against known-good hashes, and a BIOS that
                  is subtly the wrong dump fails in ways that look like a broken
                  emulator, so it is worth saying when the server has vouched
                  for the file. */}
              {item.verified ? (
                <span className="status" data-state="ok">
                  Verified
                </span>
              ) : null}
            </div>
            <div className="bios__meta">
              {item.note ?? 'Uploaded to RomM for this platform'}
              {item.sizeBytes > 0 ? ` · ${formatBytes(item.sizeBytes)}` : ''}
            </div>
            {/* Named per file rather than once per platform: on a row where
                some files go to the emulator and the rest are staged, one
                folder at the top would be wrong for half of them. */}
            {item.dir ? (
              <div className="bios__path" data-staged={item.staged}>
                {item.dir}/{item.fileName}
              </div>
            ) : null}
          </div>
          <div className="bios__actions">
            {item.firmwareId == null ? (
              <span className="faint">Not on your server</span>
            ) : (
              <FocusButton
                icon="install"
                variant="ghost"
                disabled={busy !== null || platform.biosDir === null}
                onSelect={() => onInstall(item.firmwareId as number, item.fileName, platform)}
              >
                {busy === item.fileName ? 'Installing…' : item.installed ? 'Reinstall' : 'Install'}
              </FocusButton>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

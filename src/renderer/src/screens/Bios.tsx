import { type JSX, useCallback, useEffect, useState } from 'react'
import type { BiosPlatform, BiosReport } from '@shared/types'
import { FocusButton, Hints, Overlay, PlatformIcon, Spinner, formatBytes } from '../components'
import { useApp } from '../state'

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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setReport(await window.rommix.bios.list())
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => window.rommix.bios.onProgress(setProgress), [])

  const install = async (firmwareId: number, fileName: string): Promise<void> => {
    setBusy(fileName)
    try {
      await window.rommix.bios.install(firmwareId)
      notify(`${fileName} installed`)
      await load()
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const syncAll = async (): Promise<void> => {
    setBusy('all')
    setProgress(null)
    try {
      const result = await window.rommix.bios.syncAll()
      const parts = [`${result.installed} installed`]
      if (result.failed > 0) parts.push(`${result.failed} failed`)
      if (result.unavailable > 0) parts.push(`${result.unavailable} not on the server`)
      notify(parts.join(' · '), result.failed > 0 ? 'warn' : 'ok')
      await load()
    } catch (cause) {
      notify((cause as Error).message, 'error')
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
          <FocusButton onSelect={() => void load()} autoFocus>
            Try again
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
        copies them into whichever emulator runs that platform. Nothing is downloaded from
        anywhere else.
      </p>

      <div className="btn-row">
        <FocusButton
          variant="primary"
          onSelect={() => void syncAll()}
          disabled={busy !== null || fetchable === 0}
          autoFocus
        >
          {fetchable === 0 ? 'Nothing to install' : `Install all ${fetchable}`}
        </FocusButton>
        <FocusButton onSelect={() => void load()} disabled={busy !== null}>
          Re-check
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
          />
        ))
      )}

      {busy === 'all' ? (
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
  onInstall
}: {
  platform: BiosPlatform
  busy: string | null
  onInstall: (firmwareId: number, fileName: string) => void
}): JSX.Element | null {
  // A platform with nothing needed, nothing on the server and no problem to
  // report has nothing to say. Showing it anyway would bury the handful that
  // matter under thirty rows of "fine".
  if (platform.items.length === 0 && !platform.dumpOnly && !platform.blockedReason) return null

  const outstanding = platform.items.filter((item) => !item.installed).length

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
        <span className="status" data-state={outstanding === 0 ? 'ok' : 'warn'}>
          {outstanding === 0 ? 'Ready' : `${outstanding} missing`}
        </span>
      </h2>

      <div className="bios__where">
        {platform.emulatorName && platform.biosDir
          ? `${platform.emulatorName} · ${platform.biosDir}`
          : null}
      </div>

      {platform.blockedReason ? (
        <div className="notice notice--warn">{platform.blockedReason}</div>
      ) : null}
      {platform.dumpOnly ? <div className="notice notice--warn">{platform.dumpOnly}</div> : null}

      {platform.items.map((item) => (
        <div className="bios__item" key={item.fileName}>
          <div className="bios__body">
            <div className="bios__name">
              {item.fileName}
              <span className="status" data-state={item.installed ? 'ok' : item.required ? 'warn' : 'off'}>
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
          </div>
          <div className="bios__actions">
            {item.firmwareId == null ? (
              <span className="faint">Not on your server</span>
            ) : (
              <FocusButton
                variant="ghost"
                disabled={busy !== null || platform.biosDir === null}
                onSelect={() => onInstall(item.firmwareId as number, item.fileName)}
              >
                {busy === item.fileName
                  ? 'Installing…'
                  : item.installed
                    ? 'Reinstall'
                    : 'Install'}
              </FocusButton>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

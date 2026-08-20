import { type JSX, useCallback, useEffect, useState } from 'react'
import { resolveSystem } from '@config/systems'
import type {
  BiosPlatform,
  InstalledRom,
  LaunchChoice,
  PendingSave,
  RommRom,
  SaveAsset,
  SavePushPreview,
  SaveSyncState
} from '@shared/types'
import {
  CoverArt,
  FocusButton,
  Hints,
  Overlay,
  Spinner,
  PlatformIcon,
  Tabs,
  formatBytes
} from '../components'
import { Icon, type IconName } from '../icons'
import { useApp } from '../state'

type DetailTab = 'about' | 'saves' | 'files' | 'screenshots'

/**
 * How many files the push confirmation lists before summarising the rest.
 *
 * Enough for a game's battery save and a handful of states, which is what an
 * ordinary push is; past that the list stops being something you read and the
 * count in the dialog's title is doing the work anyway.
 */
const PUSH_PREVIEW_ROWS = 8

/**
 * How each sync state reads on a row.
 *
 * The label says which side is ahead, not what to press: the two buttons move
 * everything at once, so a per-row instruction would be promising an action
 * that does not exist. `hint` is the same thing at length, on hover.
 */
const SYNC_BADGES: Record<
  SaveSyncState,
  { label: string; tone: 'ok' | 'warn' | 'off'; icon: IconName; hint: string }
> = {
  synced: {
    label: 'In sync',
    tone: 'ok',
    icon: 'confirm',
    hint: 'This device and RomM have the same file.'
  },
  'local-newer': {
    label: 'Newer here',
    tone: 'warn',
    icon: 'push',
    hint: 'Played since it was last uploaded. Push saves sends it.'
  },
  'local-only': {
    label: 'Not on RomM',
    tone: 'warn',
    icon: 'push',
    hint: 'Only on this device. Push saves sends it.'
  },
  'remote-newer': {
    label: 'Newer on RomM',
    tone: 'warn',
    icon: 'pull',
    hint: 'RomM has a more recent copy. Pull saves fetches it.'
  },
  'remote-only': {
    label: 'Not on this device',
    tone: 'off',
    icon: 'pull',
    hint: 'Only on RomM. Pull saves fetches it.'
  }
}

/**
 * A single game: artwork, metadata, and the actions that matter — download it,
 * play it, remove it.
 */
export function DetailScreen({ romId }: { romId: number }): JSX.Element {
  const {
    installed,
    downloads,
    runningRomId,
    goBack,
    navigate,
    notify,
    refreshInstalled,
    saveSettings,
    settings
  } = useApp()

  const [rom, setRom] = useState<RommRom | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  /**
   * The push waiting on an answer — from the button, or handed back by a launch
   * that held the session's files instead of uploading them. Both ask the same
   * question about the same kind of list, so both use this.
   */
  const [confirmingPush, setConfirmingPush] = useState<SavePushPreview | null>(null)
  const [choosing, setChoosing] = useState<LaunchChoice | null>(null)
  const [tab, setTab] = useState<DetailTab>('about')
  const [assets, setAssets] = useState<SaveAsset[] | null>(null)
  const [deletingAsset, setDeletingAsset] = useState<SaveAsset | null>(null)
  const [bios, setBios] = useState<BiosPlatform | null>(null)

  useEffect(() => {
    setRom(null)
    setTab('about')
    void window.rommix.library
      .rom(romId)
      .then(setRom)
      .catch((cause: Error) => setError(cause.message))
  }, [romId])

  /**
   * This game's saves on both sides, refetched after every pull or push so the
   * list is never one action out of date.
   */
  const loadAssets = useCallback(async (): Promise<void> => {
    setAssets(await window.rommix.saves.list(romId).catch(() => []))
  }, [romId])

  useEffect(() => {
    setAssets(null)
    void loadAssets()
  }, [loadAssets])

  /**
   * The BIOS situation for this game's platform.
   *
   * Asked here rather than left to the BIOS screen because this is where the
   * game is about to be started, and a missing BIOS is the most common reason
   * one refuses to — with a failure that says nothing about BIOS at all.
   */
  useEffect(() => {
    setBios(null)
    if (!rom) return
    void window.rommix.bios
      .platform(rom.platform_id)
      .then(setBios)
      .catch(() => setBios(null))
  }, [rom?.platform_id])

  const entry: InstalledRom | undefined = installed.find((item) => item.romId === romId)
  const download = downloads.find((item) => item.romId === romId)
  const active =
    download?.state === 'downloading' ||
    download?.state === 'queued' ||
    download?.state === 'extracting'
  const running = runningRomId === romId

  // Only to decide whether "Run with…" is worth showing, and what this
  // emulator still needs done by hand. The launch path asks again rather than
  // trusting either, since the emulator for a platform can be changed from
  // Settings while this screen is open.
  const [variants, setVariants] = useState<LaunchChoice['options']>([])
  const [setup, setSetup] = useState<{ emulatorId: string; notes: string[] } | null>(null)
  useEffect(() => {
    if (!entry) {
      setVariants([])
      setSetup(null)
      return
    }
    void window.rommix.game
      .variants(romId)
      .then((choice) => {
        setVariants(choice.options)
        setSetup({ emulatorId: choice.emulatorId, notes: choice.setupNotes })
      })
      .catch(() => {
        setVariants([])
        setSetup(null)
      })
  }, [romId, entry?.emulatorId, entry?.system])

  /**
   * Dismissed per emulator, not per game: the steps are about setting the
   * emulator up once, so being told again on the next Switch game would be the
   * same nagging the button exists to stop.
   */
  const noticeKey = setup ? `setup:${setup.emulatorId}` : null
  const dismissed = !noticeKey || (settings?.dismissedNotices ?? []).includes(noticeKey)
  const dismissSetup = async (): Promise<void> => {
    if (!noticeKey || dismissed) return
    await saveSettings({
      dismissedNotices: [...(settings?.dismissedNotices ?? []), noticeKey]
    })
  }

  /** How this game is named and pictured in a toast. */
  const subjectOf = (): { title: string; coverPath: string | null } => ({
    title: rom?.name ?? rom?.fs_name ?? 'Game',
    coverPath: rom?.path_cover_small ?? rom?.path_cover_large ?? null
  })

  const startDownload = async (): Promise<void> => {
    setBusy(true)
    try {
      const item = await window.rommix.downloads.start(romId)
      // Already on disk: the main process adopts it instead of queueing, so
      // saying "download started" would be a plain lie.
      notify(item.state === 'done' ? 'Already downloaded' : 'Download started', 'ok', {
        title: item.name,
        coverPath: item.coverPath
      })
    } catch {
      // Reported centrally on `app:error`; this only keeps the screen from
      // claiming a download that never started.
    } finally {
      setBusy(false)
    }
  }

  /**
   * Play, asking first when the emulator offers more than one way to run this
   * system and the user has not already said which.
   *
   * EmuDeck ships three Saturn cores and four Switch emulators; picking one
   * silently would be a guess, and the wrong guess is a game that will not
   * start or a save written where the other emulator will not find it. The
   * answer is remembered per platform, so this is asked once.
   */
  const startPlay = async (): Promise<void> => {
    setBusy(true)
    try {
      const choice = await window.rommix.game.variants(romId)
      if (choice.options.length > 1 && !choice.chosen) {
        setChoosing(choice)
        return
      }
      await play(choice.chosen ?? undefined)
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  const play = async (variant?: string): Promise<void> => {
    setChoosing(null)
    setBusy(true)
    try {
      const result = await window.rommix.game.launch(romId, variant)
      const subject = subjectOf()
      if (!result.ok) {
        notify(result.error ?? 'The game could not be started', 'error', subject)
      } else {
        const synced = result.uploadedSaves + result.uploadedStates
        const waiting = result.pendingPush?.files.length ?? 0
        notify(
          waiting > 0
            ? `Session ended — ${waiting} file${waiting === 1 ? '' : 's'} to send`
            : synced > 0
              ? `Session ended — ${synced} save file${synced === 1 ? '' : 's'} sent to RomM`
              : 'Session ended',
          result.error ? 'warn' : 'ok',
          subject
        )
        if (result.error) notify(result.error, 'warn')

        // The session's saves, held back for the same question the button
        // asks. Raised here rather than by the main process because this is
        // the side that has a screen, and the emulator has just closed over
        // it — there is no better moment to ask. The toast above says the same
        // thing, which is what the user sees if they left this screen while
        // the game was running and the dialog goes up behind them.
        if (result.pendingPush) setConfirmingPush(result.pendingPush)
      }
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /**
   * Move saves by hand, in either direction.
   *
   * The automatic sync happens around a launch, which leaves two real gaps
   * this fills: a save made on another device is not wanted *now* unless the
   * game is about to be played here, and a save made before RomMix was
   * installed is never picked up at all, because the post-session push only
   * looks at what the session wrote.
   */
  const syncSaves = async (direction: 'pull' | 'push'): Promise<void> => {
    setBusy(true)
    try {
      const result =
        direction === 'pull'
          ? await window.rommix.saves.pull(romId)
          : await window.rommix.saves.push(romId)
      const subject = subjectOf()

      if (result.skippedReason) {
        notify(result.skippedReason, 'warn', subject)
      } else {
        const moved = result.saves + result.states
        notify(
          moved === 0
            ? direction === 'pull'
              ? 'Nothing newer on RomM'
              : 'No local saves to send'
            : `${moved} file${moved === 1 ? '' : 's'} ${direction === 'pull' ? 'downloaded' : 'sent to RomM'}`,
          'ok',
          subject
        )
      }
      await loadAssets()
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /**
   * The Push saves button, which may have a question in front of it.
   *
   * The preview is fetched only when the setting is on, so the default path is
   * the single call it has always been. A preview with nothing in it never
   * becomes a dialog: there is no decision to take, and the same message the
   * push itself would have produced is more use than an empty list.
   */
  const beginPush = async (): Promise<void> => {
    if (settings?.confirmSavePush !== true) {
      await syncSaves('push')
      return
    }

    setBusy(true)
    try {
      const preview = await window.rommix.saves.pushPreview(romId)
      if (preview.files.length === 0) {
        notify(preview.skippedReason ?? 'No local saves to send', 'warn', subjectOf())
        return
      }
      setConfirmingPush(preview)
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /**
   * Send the approved files, and only those.
   *
   * By path rather than by "push everything again": the list was read and
   * agreed to, and a second scan could have picked up a file written while the
   * dialog was open — which would be an upload nobody was shown.
   */
  const sendPush = async (preview: SavePushPreview): Promise<void> => {
    setConfirmingPush(null)
    setBusy(true)
    try {
      const result = await window.rommix.saves.pushSelected(
        romId,
        preview.files.map((file) => file.path)
      )
      const moved = result.saves + result.states
      notify(
        result.skippedReason ??
          (moved === 0
            ? 'Nothing was sent'
            : `${moved} file${moved === 1 ? '' : 's'} sent to RomM`),
        result.skippedReason || moved === 0 ? 'warn' : 'ok',
        subjectOf()
      )
      await loadAssets()
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /**
   * Remove one save or state from the server.
   *
   * The server's copy only. The local file is what the emulator loads, and
   * deleting that alongside would turn clearing out old backups into losing the
   * save currently being played — so a game still on this device can simply be
   * pushed back up afterwards.
   */
  const deleteAsset = async (asset: SaveAsset): Promise<void> => {
    setDeletingAsset(null)
    // A row RomM does not have is not offered a Delete button; this is the
    // same fact stated where the id is used.
    if (asset.id === null) return
    setBusy(true)
    try {
      await window.rommix.saves.remove(romId, asset.kind, asset.id)
      notify(
        asset.localPath
          ? `${asset.fileName} deleted from RomM and this device`
          : `${asset.fileName} deleted from RomM`
      )
      await loadAssets()
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /** Re-open the picker for a platform that has already been answered. */
  const openChooser = async (): Promise<void> => {
    try {
      setChoosing(await window.rommix.game.variants(romId))
    } catch {
      // Reported centrally.
    }
  }

  const uninstall = async (): Promise<void> => {
    setConfirmingRemoval(false)
    setBusy(true)
    try {
      await window.rommix.downloads.uninstall(romId)
      await refreshInstalled()
      notify('Uninstalled', 'ok', {
        title: rom?.name ?? entry?.fileName ?? 'Game',
        coverPath: rom?.path_cover_small ?? rom?.path_cover_large ?? null
      })
    } catch {
      // Reported centrally; this only keeps "Uninstalled" from being claimed.
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="content">
        <div className="notice notice--error">{error}</div>
        <div className="btn-row">
          <FocusButton icon="back" onSelect={goBack} autoFocus>
            Back
          </FocusButton>
        </div>
      </div>
    )
  }

  if (!rom) {
    return (
      <div className="content">
        <Spinner />
      </div>
    )
  }

  /**
   * What to say about this platform's BIOS, if anything.
   *
   * Two situations are worth interrupting for. A file RomMix knows the system
   * requires and cannot find is a game that will very likely not start. A
   * console whose BIOS is a dump RomMix cannot name — the Switch and its keys —
   * with nothing whatsoever in place is the same thing, arrived at differently:
   * there is no list to check against, but an empty folder is still an answer.
   *
   * Everything else stays quiet. An optional regional BIOS that is missing, a
   * platform with no emulator, a server that would not answer — none of those
   * is a reason to put a warning between the user and the Play button.
   */
  const biosWarning = ((): string | null => {
    if (!bios || bios.blockedReason) return null

    const missing = bios.items.filter((item) => item.required && !item.installed)
    if (missing.length > 0) {
      return `${bios.platformName} needs ${missing
        .map((item) => item.fileName)
        .join(', ')} to start most games, and ${
        missing.length === 1 ? 'it is' : 'they are'
      } not installed.`
    }

    const anythingInPlace = bios.items.some((item) => item.installed)
    if (bios.setupNote && bios.items.length > 0 && !anythingInPlace) {
      return `${bios.platformName} needs its BIOS set up before games will run.`
    }
    return null
  })()

  const title = rom.name ?? rom.fs_name
  // The installed entry knows the system for certain; for a game that is not
  // downloaded it is worked out from the platform, exactly as a download would.
  const system =
    entry?.system ??
    resolveSystem(rom.platform_slug, rom.platform_fs_slug, settings?.systemOverrides)
  const year = rom.metadatum.first_release_date
    ? new Date(rom.metadatum.first_release_date * 1000).getFullYear()
    : null
  const progress =
    download && download.totalBytes > 0
      ? Math.round((download.receivedBytes / download.totalBytes) * 100)
      : 0

  return (
    <div className="content">
      <div className="hero">
        <div className="hero__art">
          <CoverArt path={rom.path_cover_large ?? rom.path_cover_small} name={title} />
        </div>
        <div>
          <h1 className="hero__title">{title}</h1>
          <div className="hero__meta">
            <span className="chip chip--icon">
              <PlatformIcon
                slug={rom.platform_slug}
                system={system}
                size={20}
                label={rom.platform_display_name}
              />
              {rom.platform_display_name}
            </span>
            {year ? <span className="chip">{year}</span> : null}
            <span className="chip">{formatBytes(rom.fs_size_bytes)}</span>
            {entry ? <span className="chip chip--on">Downloaded</span> : null}
            {rom.metadatum.genres.slice(0, 3).map((genre) => (
              <span className="chip" key={genre}>
                {genre}
              </span>
            ))}
          </div>
          {rom.summary ? <p className="hero__summary">{rom.summary}</p> : null}
        </div>
      </div>

      <div className="btn-row">
        {entry ? (
          <FocusButton
            icon="play"
            variant="primary"
            onSelect={() => void startPlay()}
            disabled={busy || running}
            autoFocus
          >
            {running ? 'Running…' : 'Play'}
          </FocusButton>
        ) : active ? (
          <FocusButton
            icon="cancel"
            variant="danger"
            onSelect={() => void window.rommix.downloads.cancel(romId)}
            autoFocus
          >
            Cancel download ({progress}%)
          </FocusButton>
        ) : (
          <FocusButton
            icon="download"
            variant="primary"
            onSelect={() => void startDownload()}
            disabled={busy}
            autoFocus
          >
            Download
          </FocusButton>
        )}

        {/* The way back to a choice already made: without it, a platform
            answered once could only be changed by editing settings. Shown only
            where there is genuinely more than one answer. */}
        {entry && variants.length > 1 ? (
          <FocusButton
            icon="emulator"
            onSelect={() => void openChooser()}
            disabled={busy || running}
          >
            Run with…
          </FocusButton>
        ) : null}

        {/* Only for a game that is here: there is no local save directory to
            read from or write into until the ROM has been downloaded. */}
        {entry ? (
          <>
            <FocusButton
              icon="pull"
              onSelect={() => void syncSaves('pull')}
              disabled={busy || running}
            >
              Pull saves
            </FocusButton>
            <FocusButton icon="push" onSelect={() => void beginPush()} disabled={busy || running}>
              Push saves
            </FocusButton>
          </>
        ) : null}

        {entry ? (
          <FocusButton
            icon="uninstall"
            variant="danger"
            onSelect={() =>
              // Without the confirmation, one A press on a focused danger
              // button deletes a multi-gigabyte download outright.
              settings?.confirmUninstall === false ? void uninstall() : setConfirmingRemoval(true)
            }
            disabled={busy || running}
          >
            Uninstall
          </FocusButton>
        ) : null}

        <FocusButton icon="back" variant="ghost" onSelect={goBack}>
          Back
        </FocusButton>
      </div>

      {active ? (
        <div className="download download--bare">
          <span className="download__name">
            {download?.state === 'extracting' ? 'Extracting…' : 'Downloading…'}
          </span>
          <span className="download__state">
            {formatBytes(download?.receivedBytes ?? 0)} / {formatBytes(download?.totalBytes ?? 0)}
          </span>
          <div className="download__bar">
            <div className="download__fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {download?.state === 'error' && download.error ? (
        <div className="notice notice--error">{download.error}</div>
      ) : null}

      {/* A platform whose BIOS is not in place, said where the game is about to
          be launched. Only what is genuinely wrong: a required file that is
          missing, or a console whose BIOS RomMix cannot name and which has
          nothing at all in place — an optional regional BIOS missing is not a
          reason to warn anybody. */}
      {biosWarning ? (
        <div className="notice notice--warn">
          {biosWarning}
          <div className="btn-row">
            <FocusButton icon="bios" variant="ghost" onSelect={() => navigate({ name: 'bios' })}>
              Open BIOS
            </FocusButton>
          </div>
        </div>
      ) : null}

      {/* What the emulator still needs done by hand. Here rather than in
          Settings because this is the screen where the game is about to be
          played, and every one of these steps looks like RomMix failing when it
          has not been done — the download is there and named, but the
          emulator's own list is empty, or the game starts unpatched. */}
      {setup && setup.notes.length > 0 && !dismissed ? (
        <div className="notice notice--warn">
          <ul className="notice__list">
            {setup.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <div className="btn-row">
            <FocusButton icon="hide" variant="ghost" onSelect={() => void dismissSetup()}>
              Don't show this again
            </FocusButton>
          </div>
        </div>
      ) : null}

      {/* Tabs rather than one long column: saves, files and screenshots are
          each a list that can run to dozens of rows, and stacking them put the
          thing you came for several screens of scrolling down. */}
      <Tabs<DetailTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'about', label: 'About' },
          { id: 'saves', label: 'Saves', badge: assets?.length },
          { id: 'files', label: 'Files', badge: rom.files.length || undefined },
          {
            id: 'screenshots',
            label: 'Screenshots',
            badge: rom.merged_screenshots?.length || undefined
          }
        ]}
      />

      {tab === 'about' ? <About rom={rom} entry={entry} /> : null}
      {tab === 'saves' ? (
        <SavesTab assets={assets} entry={entry} onDelete={setDeletingAsset} />
      ) : null}
      {tab === 'files' ? <FilesTab rom={rom} entry={entry} /> : null}
      {tab === 'screenshots' ? <ScreenshotsTab rom={rom} /> : null}

      {running ? (
        <div className="notice notice--warn">
          The game is running.{' '}
          {settings?.confirmSavePush
            ? 'RomMix will ask what to send to RomM when you quit the emulator.'
            : 'RomMix will sync your saves back to RomM when you quit the emulator.'}
        </div>
      ) : null}

      {choosing ? (
        <Overlay title={`How should ${choosing.system} games run?`}>
          <p className="muted">
            {choosing.emulatorName} can run this platform in more than one way, and which is best
            depends on the game. RomMix remembers your answer for {choosing.system} — change it
            later with Run with…
          </p>
          <div className="btn-row">
            {choosing.options.map((option) => (
              <FocusButton
                key={option.id}
                variant={option.id === choosing.chosen ? 'primary' : 'default'}
                onSelect={() => void play(option.id)}
                autoFocus={option.id === (choosing.chosen ?? choosing.options[0].id)}
              >
                {option.label}
                {option.note ? ` · ${option.note}` : ''}
              </FocusButton>
            ))}
          </div>
          <div className="btn-row">
            <FocusButton icon="cancel" variant="ghost" onSelect={() => setChoosing(null)}>
              Cancel
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      {deletingAsset ? (
        <Overlay title={`Delete this ${deletingAsset.kind} from RomM?`}>
          <p className="muted">
            {deletingAsset.fileName} will be removed from RomM
            {deletingAsset.localPath
              ? ` and from this device (${deletingAsset.localPath})`
              : ''}.{' '}
            {deletingAsset.localPath
              ? 'Both, because a save left on disk is uploaded again the next time you play — deleting only the server copy would undo itself.'
              : 'This device does not have a copy of it.'}
          </p>
          <div className="btn-row">
            <FocusButton icon="keep" onSelect={() => setDeletingAsset(null)} autoFocus>
              Keep it
            </FocusButton>
            <FocusButton
              icon="delete"
              variant="danger"
              onSelect={() => void deleteAsset(deletingAsset)}
            >
              Delete from RomM
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      {confirmingRemoval && entry ? (
        <Overlay title="Uninstall this game?">
          <p className="muted">
            {entry.fileName} will be deleted from {entry.path.replace(/\/[^/]*$/, '')}. Your saves
            on RomM are not touched, and you can download it again at any time.
          </p>
          <div className="btn-row">
            <FocusButton icon="keep" onSelect={() => setConfirmingRemoval(false)} autoFocus>
              Keep it
            </FocusButton>
            <FocusButton icon="uninstall" variant="danger" onSelect={() => void uninstall()}>
              Uninstall, freeing {formatBytes(entry.sizeBytes)}
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      {confirmingPush ? (
        <Overlay
          title={`Send ${confirmingPush.files.length} file${
            confirmingPush.files.length === 1 ? '' : 's'
          } to RomM?`}
        >
          <p className="muted">Uploaded as {confirmingPush.deviceName}.</p>
          <PushPreviewList files={confirmingPush.files} />
          <div className="btn-row">
            <FocusButton icon="cancel" onSelect={() => setConfirmingPush(null)} autoFocus>
              Cancel
            </FocusButton>
            <FocusButton
              icon="push"
              variant="primary"
              onSelect={() => void sendPush(confirmingPush)}
            >
              Send to RomM
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: entry ? 'Play' : 'Download' },
          { key: 'LB', label: 'Previous tab' },
          { key: 'RB', label: 'Next tab' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}

function About({ rom, entry }: { rom: RommRom; entry?: InstalledRom }): JSX.Element {
  return (
    <dl className="kv">
      <dt>File</dt>
      <dd>{rom.fs_name}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(rom.fs_size_bytes)}</dd>
      {rom.metadatum.companies.length > 0 ? (
        <>
          <dt>Company</dt>
          <dd>{rom.metadatum.companies.join(', ')}</dd>
        </>
      ) : null}
      {rom.regions.length > 0 ? (
        <>
          <dt>Region</dt>
          <dd>{rom.regions.join(', ')}</dd>
        </>
      ) : null}
      {rom.rom_user.last_played ? (
        <>
          <dt>Last played</dt>
          <dd>{new Date(rom.rom_user.last_played).toLocaleString()}</dd>
        </>
      ) : null}
      {entry ? (
        <>
          <dt>Installed to</dt>
          <dd>{entry.path}</dd>
          <dt>System folder</dt>
          <dd>{entry.system}</dd>
          {/* Which emulator's library holds this copy. It is the reason a game
              can be on disk and still offered as a download: pointing the
              platform elsewhere does not move the file. */}
          <dt>Downloaded for</dt>
          <dd>{entry.emulatorId}</dd>
        </>
      ) : null}
    </dl>
  )
}

/**
 * Saves and states held by RomM.
 *
 * Both kinds in one list rather than two: they answer the same question — what
 * of mine is on the server, and how recent is it — and a save and its state
 * from the same session belong next to each other.
 */
/**
 * Exactly what a push is about to send, one row per file.
 *
 * The three things worth knowing before pressing send, in the order they
 * matter: which file, what tag it will carry — a save is only loadable by the
 * emulator that wrote it, so a wrong tag is a save that never comes back — and
 * what is already on the server under that name. The last is called out when
 * the server's copy is the newer of the two, which is the one case where
 * sending is likely to be a mistake.
 */
function PushPreviewList({ files }: { files: PendingSave[] }): JSX.Element {
  // Capped rather than scrolled: nothing in this list is focusable, so a
  // scrolling panel on a gamepad is content that cannot be reached. A push of
  // ten libretro state slots is a real thing, and the count in the title is
  // already the number that decides the answer.
  const shown = files.slice(0, PUSH_PREVIEW_ROWS)
  const hidden = files.length - shown.length

  return (
    <>
      <ul className="asset-list">
        {shown.map((file) => {
          const stale = file.replaces
            ? Date.parse(file.replaces.updatedAt) > Date.parse(file.modifiedAt)
            : false

          return (
            <li key={`${file.kind}-${file.path}`}>
              <span className="asset__kind" data-kind={file.kind}>
                {file.kind === 'save' ? 'Save' : 'State'}
              </span>
              <span className="status" data-state={stale ? 'warn' : 'ok'}>
                {file.emulator}
              </span>
              <span className="asset__name">{file.fileName}</span>
              <span className="asset__meta">
                {formatBytes(file.sizeBytes)}
                {/* A Switch save is a folder of files named after nothing, so it
                  travels as one archive — worth saying, since the name above is
                  not a name anything on disk has. */}
                {file.isDirectory ? ' · folder, sent as one zip' : ''} ·{' '}
                {new Date(file.modifiedAt).toLocaleString()}
              </span>
              <span className="asset__meta">
                {file.replaces
                  ? `On RomM: ${
                      file.replaces.fromThisDevice === true
                        ? 'this device'
                        : file.replaces.fromThisDevice === false
                          ? 'another device'
                          : (file.replaces.emulator ?? 'unknown')
                    }, ${new Date(file.replaces.updatedAt).toLocaleString()}${
                      stale ? ' · newer than this' : ''
                    }`
                  : 'New on RomM'}
              </span>
            </li>
          )
        })}
      </ul>
      {hidden > 0 ? (
        <p className="muted">
          and {hidden} more file{hidden === 1 ? '' : 's'}.
        </p>
      ) : null}
    </>
  )
}

function SavesTab({
  assets,
  entry,
  onDelete
}: {
  assets: SaveAsset[] | null
  entry?: InstalledRom
  onDelete: (asset: SaveAsset) => void
}): JSX.Element {
  if (!assets) return <Spinner />
  if (assets.length === 0) {
    return (
      <div className="empty">
        No saves for this game, here or on RomM.
        {entry ? ' Play it once and its save will appear here.' : ''}
      </div>
    )
  }

  return (
    <ul className="asset-list">
      {assets.map((asset) => {
        const badge = SYNC_BADGES[asset.sync]
        // The time the badge is talking about: the end that is ahead.
        const at =
          asset.sync === 'local-only' || asset.sync === 'local-newer'
            ? asset.localModifiedAt
            : (asset.updatedAt ?? asset.localModifiedAt)

        return (
          <li key={`${asset.kind}-${asset.id ?? asset.localPath}`}>
            <span className="asset__kind" data-kind={asset.kind}>
              {asset.kind === 'save' ? 'Save' : 'State'}
            </span>
            {/* Which side has it and whether they agree — and so which button,
                if any, would do something about this row. */}
            <span className="status status--badge" data-state={badge.tone} title={badge.hint}>
              <Icon name={badge.icon} size={13} />
              {badge.label}
            </span>
            <span className="asset__name">{asset.fileName}</span>
            <span className="asset__meta">
              {formatBytes(asset.sizeBytes)}
              {asset.emulator ? ` · ${asset.emulator}` : ''}
              {/* Where it came from, when the server recorded it: the useful
                  thing to know about a save you did not expect to see. */}
              {asset.fromThisDevice === true ? ' · this device' : ''}
              {asset.fromThisDevice === false ? ' · another device' : ''}
              {at ? ` · ${new Date(at).toLocaleString()}` : ''}
            </span>
            {/* Only what RomM holds can be deleted from RomM. A file that has
                never been uploaded has nothing there to remove, and deleting
                the copy the emulator is using is not what this button means. */}
            {asset.id !== null ? (
              <span className="asset__actions">
                <FocusButton icon="delete" variant="danger" onSelect={() => onDelete(asset)}>
                  Delete
                </FocusButton>
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The files the game is made of, on the server and on this device.
 *
 * Both, because they are not always the same: RomM zips a multi-file game for
 * transport and RomMix unpacks it, so a two-file cue+bin on the server is two
 * files in a directory here — and a game whose local copy has lost a track is
 * a thing you can only see by comparing the two.
 */
function FilesTab({ rom, entry }: { rom: RommRom; entry?: InstalledRom }): JSX.Element {
  const local = entry?.files?.length ? entry.files : entry ? [entry.fileName] : []

  return (
    <>
      <h3 className="section-title" style={{ fontSize: 17 }}>
        On the server
      </h3>
      {rom.files.length === 0 ? (
        <div className="empty">RomM lists no files for this game.</div>
      ) : (
        <ul className="asset-list">
          {rom.files.map((file) => (
            <li key={file.id}>
              <span className="asset__name">{file.file_name}</span>
              <span className="asset__meta">{formatBytes(file.file_size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title" style={{ fontSize: 17 }}>
        On this device
      </h3>
      {local.length === 0 ? (
        <div className="empty">Not downloaded.</div>
      ) : (
        <ul className="asset-list">
          {local.map((file) => (
            <li key={file}>
              <span className="asset__name">{file}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ScreenshotsTab({ rom }: { rom: RommRom }): JSX.Element {
  const shots = rom.merged_screenshots ?? []
  if (shots.length === 0) {
    return <div className="empty">RomM has no screenshots for this game.</div>
  }
  return (
    <div className="shots">
      {shots.map((path) => (
        <img
          key={path}
          className="shot"
          src={window.rommix.system.imageUrl(path) ?? undefined}
          alt=""
          loading="lazy"
        />
      ))}
    </div>
  )
}

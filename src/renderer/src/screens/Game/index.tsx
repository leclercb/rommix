import { type JSX, useEffect, useState } from 'react'
import { emulatorById } from '@config/emulators'
import { resolveSystem } from '@config/systems'
import type { BiosPlatform, InstalledRom, LaunchChoice, RommRom } from '@shared/types'
import { FocusButton, Hints, Spinner, Tabs, formatBytes } from '../../components'
import { useApp } from '../../state'
import { GameHero } from './GameHero'
import {
  DeleteAssetDialog,
  LaunchVariantDialog,
  PushConfirmDialog,
  UninstallDialog
} from './dialogs'
import { DetailsTab, FilesTab, SavesTab, ScreenshotsTab } from './tabs'
import { useGameSaves } from './useGameSaves'

type GameTab = 'details' | 'saves' | 'files' | 'screenshots'

/**
 * A single game: artwork, metadata, and the actions that matter — download it,
 * play it, remove it.
 */
export function GameScreen({ romId }: { romId: number }): JSX.Element {
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
  const [choosing, setChoosing] = useState<LaunchChoice | null>(null)
  const [tab, setTab] = useState<GameTab>('details')
  /** Null until RomM has been asked, which is what the button waits on. */
  const [favourite, setFavourite] = useState<boolean | null>(null)
  const [bios, setBios] = useState<BiosPlatform | null>(null)

  useEffect(() => {
    setRom(null)
    setTab('details')
    void window.rommix.library
      .rom(romId)
      .then(setRom)
      .catch((cause: Error) => setError(cause.message))
  }, [romId])

  useEffect(() => {
    setFavourite(null)
    void window.rommix.library
      .favourite(romId)
      .then(setFavourite)
      // Asked for a button, not for the screen: a server that will not answer
      // leaves the button waiting rather than putting an error over the game.
      .catch(() => setFavourite(null))
  }, [romId])

  /**
   * The BIOS situation for this game's platform.
   *
   * Asked here rather than left to the BIOS screen because this is where the
   * game is about to be started, and a missing BIOS is the most common reason
   * one refuses to — with a failure that says nothing about BIOS at all.
   */
  // Read out before the effect so the effect closes over a number rather than
  // over `rom` while claiming to depend on one field of it.
  const platformId = rom?.platform_id ?? null
  useEffect(() => {
    setBios(null)
    if (platformId === null) return
    void window.rommix.bios
      .platform(platformId)
      .then(setBios)
      .catch(() => setBios(null))
  }, [platformId])

  const entry: InstalledRom | undefined = installed.find((item) => item.romId === romId)
  const download = downloads.find((item) => item.romId === romId)
  const active =
    download?.state === 'downloading' ||
    download?.state === 'queued' ||
    download?.state === 'extracting'
  const running = runningRomId === romId

  // Only to decide whether "Run with" is worth showing, and what this
  // emulator still needs done by hand. The launch path asks again rather than
  // trusting either, since the emulator for a platform can be changed from
  // Settings while this screen is open.
  const [variants, setVariants] = useState<LaunchChoice['options']>([])
  const [setup, setSetup] = useState<{ emulatorId: string; notes: string[] } | null>(null)
  // Read out before the effect, so what it depends on and what it closes over
  // are the same three values. Depending on `entry?.emulatorId` while using
  // `entry` is the shape that goes wrong quietly: the entry can be replaced by
  // one the effect never re-runs for.
  const installedFor = entry ? `${entry.emulatorId}:${entry.system}` : null
  useEffect(() => {
    if (installedFor === null) {
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
  }, [romId, installedFor])

  /**
   * Dismissed per emulator, not per game: the steps are about setting the
   * emulator up once, so being told again on the next Switch game would be the
   * same nagging the button exists to stop.
   */
  const noticeKey = setup ? `setup:${setup.emulatorId}` : null
  const dismissed = !noticeKey || (settings?.dismissedNotices ?? []).includes(noticeKey)
  const dismissSetup = async (): Promise<void> => {
    if (!setup || !noticeKey || dismissed) return
    await saveSettings({
      dismissedNotices: [...(settings?.dismissedNotices ?? []), noticeKey]
    })
    // The notice vanishing is ambiguous on its own — dismissed, or scrolled
    // past? — and it is dismissed for the *emulator*, which is wider than the
    // game it was dismissed from and worth saying out loud.
    notify(`Setup steps hidden for ${emulatorById(setup.emulatorId)?.name ?? setup.emulatorId}`)
  }

  /** How this game is named and pictured in a toast. */
  const subjectOf = (): { title: string; coverPath: string | null } => ({
    title: rom?.name ?? rom?.fs_name ?? 'Game',
    coverPath: rom?.path_cover_small ?? rom?.path_cover_large ?? null
  })

  /**
   * The saves half of this screen: the list, the two transfer buttons, and the
   * two questions they can raise. Its own busy flag is folded into `working`
   * below, so a transfer in progress greys out Play and Uninstall as well.
   */
  const {
    assets,
    reload,
    busy: syncing,
    syncSaves,
    beginPush,
    sendPush,
    deleteAsset,
    confirmingPush,
    setConfirmingPush,
    deleting,
    setDeleting
  } = useGameSaves(romId, subjectOf)
  const working = busy || syncing

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
      // The session is exactly what makes this list wrong: it writes save files
      // and syncs them, so every row's state and the scope its Delete button
      // names were decided before any of that happened.
      await reload()
      setBusy(false)
    }
  }

  /**
   * Mark or unmark the game on RomM.
   *
   * The state is shown before the server has confirmed it: the call is a
   * collection edit that takes a moment, and a heart that fills in only after a
   * round trip reads as a button that missed the press. It is put back if the
   * call fails.
   */
  const toggleFavourite = async (): Promise<void> => {
    if (favourite === null) return
    const next = !favourite
    setFavourite(next)
    try {
      const settled = await window.rommix.library.setFavourite(romId, next)
      setFavourite(settled)
      // Said because the change is on the *server*: the filled heart only
      // proves the button was pressed, and this is the confirmation that RomM
      // and the Favourites shelf now agree with it.
      notify(settled ? 'Added to favourites on RomM' : 'Removed from favourites', 'ok', subjectOf())
    } catch {
      setFavourite(!next)
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

  // The installed entry knows the system for certain; for a game that is not
  // downloaded it is worked out from the platform, exactly as a download would.
  const system =
    entry?.system ??
    resolveSystem(rom.platform_slug, rom.platform_fs_slug, settings?.systemOverrides)
  const progress =
    download && download.totalBytes > 0
      ? Math.round((download.receivedBytes / download.totalBytes) * 100)
      : 0

  return (
    <div className="content">
      <GameHero rom={rom} entry={entry} system={system}>
        {entry ? (
          <FocusButton
            icon="play"
            variant="primary"
            onSelect={() => void startPlay()}
            disabled={working || running}
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
            disabled={working}
            autoFocus
          >
            Download
          </FocusButton>
        )}

        {/* Marked on RomM, not here, so the shelf on the home screen and the
            same game in a browser agree. Always offered: a game does not have
            to be downloaded to be one you want to keep track of. */}
        <FocusButton
          icon="favourite"
          on={favourite === true}
          onSelect={() => void toggleFavourite()}
          disabled={favourite === null}
        >
          {favourite ? 'Remove from favourites' : 'Add to favourites'}
        </FocusButton>

        {/* The way back to a choice already made: without it, a platform
            answered once could only be changed by editing settings. Shown only
            where there is genuinely more than one answer. */}
        {entry && variants.length > 1 ? (
          <FocusButton
            icon="emulator"
            onSelect={() => void openChooser()}
            disabled={working || running}
          >
            Run with
          </FocusButton>
        ) : null}

        {/* Only for a game that is here: there is no local save directory to
            read from or write into until the ROM has been downloaded. */}
        {entry ? (
          <>
            <FocusButton
              icon="pull"
              onSelect={() => void syncSaves('pull')}
              disabled={working || running}
            >
              Pull saves
            </FocusButton>
            <FocusButton
              icon="push"
              onSelect={() => void beginPush()}
              disabled={working || running}
            >
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
            disabled={working || running}
          >
            Uninstall
          </FocusButton>
        ) : null}

        <FocusButton icon="back" variant="ghost" onSelect={goBack}>
          Back
        </FocusButton>
      </GameHero>

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
          thing you came for several screens of scrolling down.

          Strip and contents share one card, so the tabs read as the lid of what
          is under them rather than as four buttons floating above the page. */}
      <div className="panel">
        <Tabs<GameTab>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'details', label: 'Details' },
            { id: 'saves', label: 'Saves', badge: assets?.length },
            { id: 'files', label: 'Files', badge: rom.files.length || undefined },
            {
              id: 'screenshots',
              label: 'Screenshots',
              badge: rom.merged_screenshots?.length || undefined
            }
          ]}
        />

        <div className="panel__body">
          {tab === 'details' ? <DetailsTab rom={rom} entry={entry} /> : null}
          {tab === 'saves' ? (
            <SavesTab
              assets={assets}
              entry={entry}
              onDelete={(asset, scope) => setDeleting({ asset, scope })}
            />
          ) : null}
          {tab === 'files' ? <FilesTab rom={rom} entry={entry} /> : null}
          {tab === 'screenshots' ? <ScreenshotsTab rom={rom} /> : null}
        </div>
      </div>

      {running ? (
        <div className="notice notice--warn">
          The game is running.{' '}
          {settings?.confirmSavePush
            ? 'RomMix will ask what to send to RomM when you quit the emulator.'
            : 'RomMix will sync your saves back to RomM when you quit the emulator.'}
        </div>
      ) : null}

      {choosing ? (
        <LaunchVariantDialog
          choice={choosing}
          onPick={(variant) => void play(variant)}
          onCancel={() => setChoosing(null)}
        />
      ) : null}

      {deleting ? (
        <DeleteAssetDialog
          asset={deleting.asset}
          scope={deleting.scope}
          onKeep={() => setDeleting(null)}
          onDelete={() => void deleteAsset(deleting.asset, deleting.scope)}
        />
      ) : null}

      {confirmingRemoval && entry ? (
        <UninstallDialog
          entry={entry}
          onKeep={() => setConfirmingRemoval(false)}
          onUninstall={() => void uninstall()}
        />
      ) : null}

      {confirmingPush ? (
        <PushConfirmDialog
          preview={confirmingPush}
          onCancel={() => setConfirmingPush(null)}
          onSend={(stopAsking) => void sendPush(confirmingPush, stopAsking)}
        />
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

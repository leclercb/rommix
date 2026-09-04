import { type JSX, useEffect, useState } from 'react'
import { resolveSystem } from '@config/systems'
import { isStopped, type BiosPlatform, type InstalledRom, type RommRom } from '@shared/types'
import { DownloadBadge, DownloadBar, FocusButton, Hints, Spinner, Tabs } from '../../components'
import { Icon } from '../../icons'
import { useApp, useDownloads, useI18n } from '../../state'
import { CollectionsDialog } from './CollectionsDialog'
import { StatusDialog } from './StatusDialog'
import { GameHero } from './GameHero'
import {
  DeleteAssetDialog,
  LaunchVariantDialog,
  PushConfirmDialog,
  UninstallDialog
} from './dialogs'
import { DetailsTab, FilesTab, SavesTab, ScreenshotsTab } from './tabs'
import { useGameCopy } from './useGameCopy'
import { useGameLaunch } from './useGameLaunch'
import { useGameMarks } from './useGameMarks'
import { useGameSaves } from './useGameSaves'

type GameTab = 'details' | 'saves' | 'files' | 'screenshots'

/**
 * A single game: artwork, metadata, and the actions that matter — download it,
 * play it, remove it.
 */
export function GameScreen({ romId }: { romId: number }): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { installed, offline, runningRomId, goBack, navigate, notify, settings, unsentSaves } =
    useApp()
  const downloads = useDownloads()

  const [rom, setRom] = useState<RommRom | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<GameTab>('details')
  const [choosingStatus, setChoosingStatus] = useState(false)
  const [bios, setBios] = useState<BiosPlatform | null>(null)
  /** True while the shelves this game is on are being looked at or changed. */
  const [choosingCollections, setChoosingCollections] = useState(false)

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
    // Asked away from the server too: the answer is what the platform needs and
    // what is in place here, and only the list of what RomM holds comes from
    // the server — which it saved the last time it was asked. See
    // `BiosManager.platformReport`.
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
    download?.state === 'checking' ||
    download?.state === 'extracting' ||
    download?.state === 'installing'
  /**
   * Whether the queue would still act on this transfer.
   *
   * The three states after the last byte are not among them: the file is being
   * hashed, unpacked or written into the index, and `DownloadManager.pause` and
   * `cancel` both refuse a row in any of them. See `DownloadState`.
   */
  const interruptible = download?.state === 'queued' || download?.state === 'downloading'
  const running = runningRomId === romId

  /** How this game is named and pictured in a toast. */
  const subjectOf = (): { title: string; coverPath: string | null } => ({
    title: rom?.name ?? rom?.fs_name ?? t('game.fallbackTitle'),
    coverPath: rom?.path_cover_small ?? rom?.path_cover_large ?? null
  })

  /**
   * The saves half of this screen: the list, the two transfer buttons, and the
   * two questions they can raise. Its own busy flag is folded into `working`
   * below, so a transfer in progress greys out Play and Uninstall as well.
   */
  const {
    assets,
    waiting: savesWaiting,
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

  const { favourite, toggleFavourite, status, setStatus, chooseStatus } = useGameMarks(
    romId,
    subjectOf
  )
  const {
    busy: launching,
    variants,
    choosing,
    setChoosing,
    startPlay,
    play,
    openChooser,
    setupNotes,
    dismissSetup
  } = useGameLaunch({
    romId,
    entry,
    subjectOf,
    afterSession: reload,
    onPendingPush: setConfirmingPush
  })
  const {
    busy: copying,
    startDownload,
    uninstall,
    confirmingRemoval,
    setConfirmingRemoval
  } = useGameCopy({ romId, rom, entry, download })

  /**
   * The game itself, and the status it arrives carrying.
   *
   * Below the hooks because one of them owns the status: the overlay comes back
   * on this same response, and asking for it separately would be a second round
   * trip for something already in hand. See `useGameMarks`.
   */
  useEffect(() => {
    setRom(null)
    setTab('details')
    void window.rommix.library
      .rom(romId)
      .then((fetched) => {
        setRom(fetched)
        setStatus(fetched.rom_user.status)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [romId, setStatus])

  /**
   * Anything in flight greys out everything else.
   *
   * Four hooks with a busy flag each, folded into one: a save transfer, a
   * session, a download and an uninstall all touch the same game, and pressing
   * a second while the first is running is never what was meant.
   */
  const working = syncing || launching || copying

  if (error) {
    return (
      <div className="content">
        <div className="notice notice--error">{error}</div>
        <div className="btn-row">
          <FocusButton icon="back" onSelect={goBack} autoFocus>
            {t('action.back')}
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
      return t('game.biosMissing', {
        count: missing.length,
        platform: bios.platformName,
        files: missing.map((item) => item.fileName).join(', ')
      })
    }

    const anythingInPlace = bios.items.some((item) => item.installed)
    if (bios.setupNote && bios.items.length > 0 && !anythingInPlace) {
      return t('game.biosSetup', { platform: bios.platformName })
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

  /**
   * Why this game's saves have not gone up, in as many lines as there are
   * reasons.
   *
   * Two, and they are not the same news. A file RomM holds a copy of that this
   * device did not put there is a decision RomMix will not make for anybody.
   * The rest are held by a setting, and naming it is the point: nothing is
   * wrong with them, and the person reading this is the one who turned it on.
   * Both can be true at once, for different files in one session.
   */
  const outstanding = unsentSaves.find((game) => game.romId === romId)
  const waitingReasons = [
    outstanding && outstanding.conflicts > 0 ? t('saves.waitingConflict') : null,
    outstanding && outstanding.ready > 0 ? t('saves.waitingConfirm') : null
  ].filter((reason) => reason !== null)

  return (
    <div className="content">
      <GameHero rom={rom} entry={entry} system={system} status={status}>
        {entry ? (
          <FocusButton
            icon="play"
            action="play"
            variant="primary"
            onSelect={() => void startPlay()}
            disabled={working || running}
            autoFocus
          >
            {running ? t('game.running') : t('game.play')}
          </FocusButton>
        ) : active && !interruptible ? (
          /* The bytes are all here and the game is being put in place, which
             is not something to be stopped half way: both buttons below were
             refused by the queue, so what is left is to say what is happening.
             Which part of it is happening is the badge under the banner. */
          <FocusButton icon="install" variant="primary" disabled onSelect={() => {}}>
            {t('action.installing')}
          </FocusButton>
        ) : active ? (
          <>
            {/* Stopping and giving up are different answers, and the one that
                costs nothing goes first: a transfer paused here keeps every
                byte it has, and the same Download button below finishes it.
                Offered only where that is true — against a server that will
                not serve part of a file, pausing keeps nothing. */}
            {download?.resumable !== false ? (
              <FocusButton
                icon="pause"
                action="pause"
                onSelect={() => void window.rommix.downloads.pause(romId)}
                autoFocus
              >
                {t('game.pauseDownload', { percent: progress })}
              </FocusButton>
            ) : null}
            <FocusButton
              icon="cancel"
              variant="danger"
              onSelect={() => void window.rommix.downloads.cancel(romId)}
              autoFocus={download?.resumable === false}
            >
              {t('game.cancelDownload', { percent: progress })}
            </FocusButton>
          </>
        ) : (
          <FocusButton
            icon="download"
            action="download"
            variant="primary"
            onSelect={() => void startDownload()}
            disabled={working}
            autoFocus
          >
            {/* The same button either way: what the player wants is the game,
                and whether that means starting or finishing a transfer is not
                a second decision to make. How far it got is on the button, as
                it is on the two that stopped it. */}
            {isStopped(download?.state ?? 'downloading')
              ? t('game.resumeDownload', { percent: progress })
              : t('action.download')}
          </FocusButton>
        )}

        {/* A transfer that was stopped is still a transfer to be rid of, and
            this was the one screen with no way to say so — Resume was the only
            thing on offer, and the queue was the only place to change one's
            mind. */}
        {isStopped(download?.state ?? 'downloading') ? (
          <FocusButton
            icon="cancel"
            variant="danger"
            onSelect={() => void window.rommix.downloads.cancel(romId)}
          >
            {t('game.cancelDownload', { percent: progress })}
          </FocusButton>
        ) : null}

        {/* The three marks that live on RomM rather than on this disk. Greyed
            while it is away rather than taken off the screen: a heart that
            cannot be saved undoes itself a second after it is pressed, but a
            heart that has vanished has moved Play under the player's thumb and
            told a first-time offline user that RomMix has no favourites. */}

        {/* Marked on RomM, so the Favourites row on the home screen and the
            same game in a browser agree. Always offered: a game does not have
            to be downloaded to be marked. Icon only — a filled heart says which
            way it is set, and the word beside it said the same thing twice;
            `actionLabel` is what the hint bar and a screen reader get. */}
        <FocusButton
          icon="favourite"
          action="favourite"
          on={favourite === true}
          actionLabel={favourite ? t('game.removeFavourite') : t('game.addFavourite')}
          onSelect={() => void toggleFavourite()}
          disabled={favourite === null || offline === true}
        />

        {/* And how far through it you are, next to the heart for the same
            reason: both are a mark on the game rather than on the copy here.
            Icon only — the answer is already a tag under the title, and the
            button would have said it a second time. */}
        <FocusButton
          icon="note"
          action="status"
          actionLabel={t('status.button')}
          onSelect={() => setChoosingStatus(true)}
          disabled={offline === true}
        />

        {/* Collections on RomM. Beside the heart because both mark the game on
            the server rather than touching the copy on this disk. */}
        <FocusButton
          icon="collection"
          action="collections"
          onSelect={() => setChoosingCollections(true)}
          disabled={offline === true}
        >
          {t('collections.button')}
        </FocusButton>

        {/* The way back to a choice already made: without it, a platform
            answered once could only be changed by editing settings. Shown only
            where there is genuinely more than one answer. */}
        {entry && variants.length > 1 ? (
          <FocusButton
            icon="emulator"
            action="run-with"
            onSelect={() => void openChooser()}
            disabled={working || running}
          >
            {t('game.runWith')}
          </FocusButton>
        ) : null}

        {/* Only for a game that is here: there is no local save directory to
            read from or write into until the ROM has been downloaded. Greyed
            while RomM is away, since neither direction has anywhere to go —
            the saves a session writes are still written, they simply do not go
            up until something can reach the server. */}
        {entry ? (
          <>
            <FocusButton
              icon="pull"
              action="pull-saves"
              onSelect={() => void syncSaves('pull')}
              disabled={working || running || offline === true}
            >
              {t('game.pullSaves')}
            </FocusButton>
            {/* Always asks while a session's saves are outstanding, whatever
                the confirmation setting says. Those are precisely the files
                RomMix would not send on its own — RomM holds a copy from
                somewhere else, or a newer one — so sending them blind is the
                one press on this screen that can lose somebody's progress. */}
            <FocusButton
              icon="push"
              action="push-saves"
              onSelect={() => void beginPush(savesWaiting)}
              disabled={working || running || offline === true}
            >
              {t('game.pushSaves')}
            </FocusButton>
          </>
        ) : null}

        {entry ? (
          <FocusButton
            icon="uninstall"
            action="uninstall"
            variant="danger"
            onSelect={() =>
              // Without the confirmation, one A press on a focused danger
              // button deletes a multi-gigabyte download outright.
              settings?.confirmUninstall === false ? void uninstall() : setConfirmingRemoval(true)
            }
            disabled={working || running}
          >
            {t('action.uninstall')}
          </FocusButton>
        ) : null}

        <FocusButton icon="back" variant="ghost" onSelect={goBack}>
          {t('action.back')}
        </FocusButton>
      </GameHero>

      {/* Paused as well as moving: where a transfer stopped is the thing being
          decided about, and the bar is what shows it.

          The same panel the queue draws, minus the game — which game this is is
          the rest of this screen, and repeating it here would be the only thing
          on the page saying it twice. */}
      {active || isStopped(download?.state ?? 'downloading') ? (
        <div className="download download--bare">
          <span className="download__facts">
            {download?.state === 'downloading' && download.currentFile ? (
              <span className="download__fact download__fact--file">
                <Icon name="file" size={13} />
                <span className="download__filename">{download.currentFile}</span>
              </span>
            ) : null}
          </span>
          {/* State then figures, in that order and in that corner, exactly as a
              queue row has them — the two screens show the same transfer. */}
          <div className="download__figures">
            <DownloadBadge state={download?.state ?? 'downloading'} />
            <span className="download__size">
              {formatBytes(download?.receivedBytes ?? 0)} / {formatBytes(download?.totalBytes ?? 0)}
            </span>
          </div>
          <DownloadBar state={download?.state ?? 'downloading'} percent={progress} />
        </div>
      ) : null}

      {download?.state === 'error' && download.error ? (
        <div className="notice notice--error">{download.error}</div>
      ) : null}

      {/* Saves a session wrote that RomMix would not hand over on its own —
          because RomM's copy came from somewhere else or has moved on, or
          because the user has asked to be asked. The only place it is said:
          this is the screen with the button that answers it, and a warning on
          any other screen is one the user cannot act on from there. */}
      {waitingReasons.length > 0 ? (
        <div className="notice notice--warn">
          {waitingReasons.length === 1 ? (
            waitingReasons[0]
          ) : (
            <ul className="notice__list">
              {waitingReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
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
              {t('game.openBios')}
            </FocusButton>
          </div>
        </div>
      ) : null}

      {/* What the emulator still needs done by hand. Here rather than in
          Settings because this is the screen where the game is about to be
          played, and every one of these steps looks like RomMix failing when it
          has not been done — the download is there and named, but the
          emulator's own list is empty, or the game starts unpatched. */}
      {setupNotes ? (
        <div className="notice notice--warn">
          <ul className="notice__list">
            {setupNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <div className="btn-row">
            <FocusButton icon="hide" variant="ghost" onSelect={() => void dismissSetup()}>
              {t('setup.dontShowAgain')}
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
            { id: 'details', label: t('game.tabDetails'), icon: 'details' },
            { id: 'saves', label: t('game.tabSaves'), icon: 'saves', badge: assets?.length },
            {
              id: 'files',
              label: t('game.tabFiles'),
              icon: 'file',
              badge: rom.files.length || undefined
            },
            {
              id: 'screenshots',
              label: t('game.tabScreenshots'),
              icon: 'screenshots',
              badge: rom.merged_screenshots?.length || undefined
            }
          ]}
        />

        <div className="panel__body">
          {tab === 'details' ? <DetailsTab rom={rom} entry={entry} /> : null}
          {tab === 'saves' ? (
            <SavesTab assets={assets} entry={entry} onDelete={(asset) => setDeleting(asset)} />
          ) : null}
          {tab === 'files' ? <FilesTab rom={rom} entry={entry} /> : null}
          {tab === 'screenshots' ? <ScreenshotsTab rom={rom} /> : null}
        </div>
      </div>

      {running ? (
        <div className="notice notice--warn">
          {settings?.confirmSavePush ? t('game.runningAsk') : t('game.runningAuto')}
        </div>
      ) : null}

      {choosingStatus ? (
        <StatusDialog
          current={status}
          onChoose={(next) => {
            setChoosingStatus(false)
            void chooseStatus(next)
          }}
          onClose={() => setChoosingStatus(false)}
        />
      ) : null}

      {choosingCollections ? (
        <CollectionsDialog
          romId={romId}
          onClose={() => setChoosingCollections(false)}
          onError={(message) => notify(message, 'error')}
        />
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
          asset={deleting}
          onKeep={() => setDeleting(null)}
          onDelete={(scope) => void deleteAsset(deleting, scope)}
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
          // The setting is what makes stopping possible: where the ask was
          // forced by files a session left behind, there is nothing to stop.
          canStopAsking={settings?.confirmSavePush === true}
          onCancel={() => setConfirmingPush(null)}
          onSend={(stopAsking) => void sendPush(confirmingPush, stopAsking)}
        />
      ) : null}

      <Hints
        items={[
          { key: 'A', label: entry ? t('game.play') : t('action.download') },
          { key: 'LB', label: t('action.previousTab') },
          { key: 'RB', label: t('action.nextTab') },
          { key: 'B', label: t('action.back') }
        ]}
      />
    </div>
  )
}

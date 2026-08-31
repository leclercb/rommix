import { useState } from 'react'
import type { MessageKey } from '@shared/i18n'
import type { DownloadItem, InstalledRom, RommRom } from '@shared/types'
import { useApp, useI18n } from '../../state'

/**
 * What to say about a press of the download button.
 *
 * The button is one thing and what it does is four: the game was already on
 * disk and has been adopted, it is on the wire, it is behind something else and
 * will be for as long as that takes, or it is one of those two having been
 * picked up rather than started. The row comes back in the state it settled
 * into, which is the only thing that knows which — "Download started" over a
 * game that is fifth in a queue is the reason this is not one phrase.
 */
export function startedMessage(item: DownloadItem, resuming: boolean): MessageKey {
  if (item.state === 'done') return 'game.alreadyDownloaded'
  if (item.state === 'queued') return resuming ? 'toast.downloadRequeued' : 'game.downloadQueued'
  return resuming ? 'toast.downloadResumed' : 'game.downloadStarted'
}

/**
 * Getting the game onto this disk, and taking it off again.
 *
 * The pair that touch the copy here rather than the game on the server — see
 * `useGameMarks` for the other half — and the reason they share a hook is that
 * they share a busy flag: neither should be pressable while the other is
 * running, and neither should be pressable while a session is open.
 */
export function useGameCopy(options: {
  romId: number
  rom: RommRom | null
  entry: InstalledRom | undefined
  download: DownloadItem | undefined
}): {
  busy: boolean
  startDownload: () => Promise<void>
  uninstall: () => Promise<void>
  confirmingRemoval: boolean
  setConfirmingRemoval: (confirming: boolean) => void
} {
  const { romId, rom, entry, download } = options
  const { t } = useI18n()
  const { notify, refreshInstalled } = useApp()
  const [busy, setBusy] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)

  const startDownload = async (): Promise<void> => {
    setBusy(true)
    // Read before the call, because the answer changes it: the same button
    // finishes a transfer that was stopped, and picking one up again is not
    // the same news as starting one.
    const resuming = download?.state === 'paused'
    try {
      const item = await window.rommix.downloads.start(romId)
      notify(t(startedMessage(item, resuming)), 'ok', {
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

  const uninstall = async (): Promise<void> => {
    setConfirmingRemoval(false)
    setBusy(true)
    try {
      await window.rommix.downloads.uninstall(romId)
      await refreshInstalled()
      notify(t('downloads.uninstalled'), 'ok', {
        title: rom?.name ?? entry?.fileName ?? t('game.fallbackTitle'),
        coverPath: rom?.path_cover_small ?? rom?.path_cover_large ?? null
      })
    } catch {
      // Reported centrally; this only keeps "Uninstalled" from being claimed.
    } finally {
      setBusy(false)
    }
  }

  return { busy, startDownload, uninstall, confirmingRemoval, setConfirmingRemoval }
}

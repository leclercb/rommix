import { useCallback, useEffect, useState } from 'react'
import type { SaveAsset, SaveDeleteScope, SavePushPreview } from '@shared/types'
import { useApp } from '../../state'
import { DELETE_SCOPES } from './tabs'

/** How this game is named and pictured in a toast. */
type Subject = () => { title: string; coverPath: string | null }

/**
 * This game's saves, and the four things the game screen does to them: pull,
 * push, push a confirmed selection, delete one end.
 *
 * A hook rather than more of the screen because these are one subject with one
 * invariant: every one of them changes what is on the two sides, so every one
 * of them has to reload the list afterwards — and a screen that also downloads,
 * launches and uninstalls is where that rule goes missing from.
 *
 * `busy` is the hook's own: the screen ORs it into the flag that greys the
 * buttons out, so a push in progress disables Play exactly as it did when both
 * were one flag.
 */
export function useGameSaves(
  romId: number,
  subject: Subject
): {
  assets: SaveAsset[] | null
  reload: () => Promise<void>
  busy: boolean
  syncSaves: (direction: 'pull' | 'push') => Promise<void>
  beginPush: () => Promise<void>
  sendPush: (preview: SavePushPreview, stopAsking?: boolean) => Promise<void>
  deleteAsset: (asset: SaveAsset, scope: SaveDeleteScope) => Promise<void>
  /**
   * The push waiting on an answer — from the button, or handed back by a launch
   * that held the session's files instead of uploading them. Both ask the same
   * question about the same kind of list, so both use this.
   */
  confirmingPush: SavePushPreview | null
  setConfirmingPush: (preview: SavePushPreview | null) => void
  /** The row and the end it was asked to be deleted from, awaiting an answer. */
  deleting: { asset: SaveAsset; scope: SaveDeleteScope } | null
  setDeleting: (target: { asset: SaveAsset; scope: SaveDeleteScope } | null) => void
} {
  const { notify, settings, saveSettings } = useApp()
  const [assets, setAssets] = useState<SaveAsset[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingPush, setConfirmingPush] = useState<SavePushPreview | null>(null)
  const [deleting, setDeleting] = useState<{ asset: SaveAsset; scope: SaveDeleteScope } | null>(
    null
  )

  /**
   * This game's saves on both sides, refetched after every pull or push so the
   * list is never one action out of date.
   */
  const reload = useCallback(async (): Promise<void> => {
    setAssets(await window.rommix.saves.list(romId).catch(() => []))
  }, [romId])

  useEffect(() => {
    setAssets(null)
    void reload()
  }, [reload])

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
      const to = subject()

      if (result.skippedReason) {
        notify(result.skippedReason, 'warn', to)
      } else {
        const moved = result.saves + result.states
        notify(
          moved === 0
            ? direction === 'pull'
              ? 'Nothing newer on RomM'
              : 'No local saves to send'
            : `${moved} file${moved === 1 ? '' : 's'} ${direction === 'pull' ? 'downloaded' : 'sent to RomM'}`,
          'ok',
          to
        )
      }
      await reload()
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
        notify(preview.skippedReason ?? 'No local saves to send', 'warn', subject())
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
  const sendPush = async (preview: SavePushPreview, stopAsking = false): Promise<void> => {
    setConfirmingPush(null)
    setBusy(true)
    try {
      // Before the push, and said out loud: the answer is about every future
      // session, not about this upload, so a push that fails must not take the
      // setting down with it, and a toggle that flips in Settings with nothing
      // on screen reads as a button that did something else.
      if (stopAsking) {
        await saveSettings({ confirmSavePush: false })
        notify('Saves will be sent without asking')
      }
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
        subject()
      )
      await reload()
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /**
   * Remove one save or state from the one end the button named.
   *
   * The other copy is deliberately left alone — that is what makes "delete the
   * bad one here, then pull RomM's" possible — so the list is reloaded
   * afterwards and the row comes back with the badge for whichever end is left.
   */
  const deleteAsset = async (asset: SaveAsset, scope: SaveDeleteScope): Promise<void> => {
    setDeleting(null)
    setBusy(true)
    try {
      await window.rommix.saves.remove(romId, asset.kind, asset.id, asset.fileName, scope)
      notify(`${asset.fileName} deleted ${DELETE_SCOPES[scope].where}`)
      await reload()
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  return {
    assets,
    reload,
    busy,
    syncSaves,
    beginPush,
    sendPush,
    deleteAsset,
    confirmingPush,
    setConfirmingPush,
    deleting,
    setDeleting
  }
}

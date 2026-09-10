import type { SaveProgress } from '@shared/api'
import type {
  SaveAsset,
  SaveDeleteScope,
  SavePushPreview,
  SavesWaiting,
  SaveSyncResult
} from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { saveContext } from './context.ts'
import type { Handle } from './handler.ts'

/**
 * How often the bytes of the file in flight are reported to the renderer.
 *
 * The same reasoning as the BIOS install's own throttle: a chunk lands
 * thousands of times over a directory save, the bar cannot show the difference
 * between one and the next, and every message crosses IPC and redraws the
 * screen. See `PROGRESS_INTERVAL_MS` in `ipc/bios.ts`.
 */
const PROGRESS_INTERVAL_MS = 250

/**
 * One transfer's progress, on its way to the game screen.
 *
 * Anything that moves the run along — a new file, a file finished — goes
 * straight out, so the count and the name are never stale. Only the byte
 * counter inside one file is held back.
 */
function saveProgress(rommix: RomMixApp): (progress: SaveProgress) => void {
  let sentAt = 0
  let sentFor: string | null = null

  return (progress) => {
    const step = `${progress.done}:${progress.fileName}`
    const now = Date.now()
    if (step === sentFor && now - sentAt < PROGRESS_INTERVAL_MS) return
    sentAt = now
    sentFor = step
    rommix.send('saves:progress', progress)
  }
}

/** Moving saves and states between this device and RomM, in either direction. */
export function registerSaveIpc(rommix: RomMixApp, handle: Handle): void {
  const { saveSync } = rommix

  /**
   * Both ends of this ROM's saves, for the game screen's list.
   *
   * The context is optional here where every other save call requires it: a
   * game that is not downloaded still has saves worth looking at, it simply has
   * none of them on this device — and without a context there is no save tree
   * to scan, so every row comes back as the server's alone.
   */
  handle('saves:list', async (romId: number): Promise<SaveAsset[]> => {
    const local = await saveContext(rommix, romId).catch(() => null)
    return saveSync.listAssets(romId, local ?? undefined)
  })

  /**
   * Games whose saves are still on this disk and not on RomM.
   *
   * Read by the game's own page, which is the only screen that says anything
   * about them — and the only one with the button that answers them. See
   * `RomMixApp.waitingSaves`.
   */
  handle('saves:waiting', (): Promise<SavesWaiting[]> => rommix.waitingSaves())

  handle('saves:pull', async (romId: number): Promise<SaveSyncResult> =>
    saveSync.pullNow(await saveContext(rommix, romId), saveProgress(rommix))
  )

  /**
   * Everything on this disk for this game, sent now.
   *
   * Clears the note that this game's saves were left behind, because after this
   * there is nothing left to leave: the push is unbounded in time and takes
   * whatever the emulator wrote, whenever it wrote it. See `sendUnsentSaves`.
   */
  handle('saves:push', async (romId: number): Promise<SaveSyncResult> => {
    const result = await saveSync.pushNow(await saveContext(rommix, romId), saveProgress(rommix))
    await rommix.recheckUnsentSaves(romId)
    return result
  })

  /**
   * What a push would send, for the confirmation dialog.
   *
   * A separate call rather than a flag on `saves:push`: the dialog has to be
   * answered between the two, and a push that returned "here is what I would
   * have done" would leave the renderer holding a decision the main process has
   * already half-made.
   */
  handle('saves:pushPreview', async (romId: number): Promise<SavePushPreview> =>
    saveSync.previewPush(await saveContext(rommix, romId))
  )

  /**
   * Send the files a confirmation dialog just approved.
   *
   * Named by path, and `pushSelected` intersects them with its own scan rather
   * than uploading what it is handed — the list came from this process in the
   * first place, and a path is not something the renderer gets to invent.
   */
  handle('saves:pushSelected', async (romId: number, paths: string[]): Promise<SaveSyncResult> => {
    const result = await saveSync.pushSelected(
      await saveContext(rommix, romId),
      paths,
      saveProgress(rommix)
    )
    // The list that was approved is the list that was waiting, so answering
    // it is the end of the matter however many files went.
    await rommix.recheckUnsentSaves(romId)
    return result
  })

  /**
   * Delete one save or state from one end of the sync — this device, or RomM.
   *
   * One end, because the other is usually the copy being kept: deleting here is
   * how a bad local save is thrown away and RomM's pulled back over it. `id` is
   * null for a file only this device has, which has no server copy to remove
   * and is named instead.
   */
  handle(
    'saves:delete',
    async (
      romId: number,
      kind: 'save' | 'state',
      id: number | null,
      fileName: string,
      scope: SaveDeleteScope
    ): Promise<void> => {
      const local = await saveContext(rommix, romId).catch(() => null)
      await saveSync.deleteAsset(romId, kind, id, fileName, scope, local ?? undefined)
    }
  )
}

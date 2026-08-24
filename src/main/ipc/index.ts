import type { RomMixApp } from '../app.ts'
import { registerBiosIpc } from './bios.ts'
import { registerDownloadIpc } from './downloads.ts'
import { registerEmulatorIpc } from './emulators.ts'
import { registerGameIpc } from './game.ts'
import { handler } from './handler.ts'
import { registerLibraryIpc } from './library.ts'
import { registerSaveIpc } from './saves.ts'
import { registerServerIpc } from './server.ts'
import { registerSystemIpc } from './system.ts'
import { registerUpdateIpc } from './updates.ts'

/**
 * The IPC surface, one module per thing the interface can ask about.
 *
 * Split by subject rather than kept as one list because that is how it is read:
 * a change to how saves are pushed is a change to `saves.ts`, and nothing else
 * in here can be involved. What every module shares is `handler` — the wrapper
 * that logs the call, reports the failure and hands a readable message across
 * the bridge — so no handler anywhere has to remember to do any of that.
 *
 * Registration order is the order the channels are declared in; nothing depends
 * on it, since a channel is only reachable once the renderer asks for it.
 */
export function registerIpc(rommix: RomMixApp): void {
  const handle = handler((message) => rommix.send('app:error', message))

  registerServerIpc(rommix, handle)
  registerLibraryIpc(rommix, handle)
  registerDownloadIpc(rommix, handle)
  registerGameIpc(rommix, handle)
  registerSaveIpc(rommix, handle)
  registerBiosIpc(rommix, handle)
  registerEmulatorIpc(rommix, handle)
  registerSystemIpc(rommix, handle)
  registerUpdateIpc(rommix, handle)
}

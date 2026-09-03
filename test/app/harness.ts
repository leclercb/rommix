import { standInEmulator, startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * One RomMix, one fake RomM, and one emulator that is a shell script.
 *
 * Here rather than in each scenario file because the settings below are not
 * decoration: `games.test.ts` cannot launch anything without the emulator path,
 * and `interface.test.ts` reads the same path back off the emulators screen. A
 * copy in each would let the two drift, and the failure would be a screen
 * disagreeing with a launch that no longer happens in the same file.
 */
export interface Scenario {
  server: FakeRomm
  app: App
  emulator: ReturnType<typeof standInEmulator>
  /** Shut both down. Tolerates a server a scenario closed on purpose. */
  stop: () => Promise<void>
}

export async function startScenario(): Promise<Scenario> {
  const server = await startFakeRomm()
  const emulator = standInEmulator()
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    settings: {
      // Eden, pointed at a shell script. `emulatorPaths` is an ordinary setting
      // that exists for the person whose AppImage is somewhere RomMix does not
      // look — it is not a seam added for the tests, which is what makes a
      // launch drivable without one.
      systemEmulators: { switch: 'eden' },
      emulatorPaths: { eden: emulator.path },
      // The push after a session would otherwise stop to ask, and there is
      // nobody here to answer it.
      confirmSavePush: false
    }
  })

  return {
    server,
    app,
    emulator,
    stop: async () => {
      await app.stop()
      await server.close().catch(() => undefined)
    }
  }
}

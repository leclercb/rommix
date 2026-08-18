import { retroarch } from './retroarch.ts'
import { retrodeck } from './retrodeck.ts'
import type { EmulatorDescriptor, EmulatorId, EmulatorState } from './types.ts'

/**
 * Every emulator Rommix knows how to drive.
 *
 * Order is meaningful: it is the tie-break when Rommix has to pick one for the
 * user, so frontends come first — RetroDECK covers the most systems and
 * already encodes the user's own per-system emulator preferences.
 */
export const EMULATORS: readonly EmulatorDescriptor[] = [retrodeck, retroarch]

export function emulatorById(id: EmulatorId): EmulatorDescriptor | null {
  return EMULATORS.find((emulator) => emulator.id === id) ?? null
}

/** Can this emulator run this ES-DE system? Frontends answer for themselves. */
export function supportsSystem(emulator: EmulatorDescriptor, system: string): boolean {
  return emulator.systems === 'delegated' || emulator.systems.includes(system)
}

export function emulatorsForSystem(system: string): EmulatorDescriptor[] {
  return EMULATORS.filter((emulator) => supportsSystem(emulator, system))
}

/**
 * Pick the emulator to use: the preferred one when it can do the job,
 * otherwise the first available one that can.
 *
 * `system` narrows the candidates to emulators that actually run it. Without
 * it the fallback would happily hand an SNES ROM to a Switch emulator, which
 * is the failure mode a flat "preferred runner" setting invites once there is
 * more than one standalone emulator installed.
 */
export function chooseEmulator(
  states: readonly EmulatorState[],
  preferredId: EmulatorId,
  system?: string
): EmulatorState | null {
  const usable = states.filter((state) => {
    if (!state.available) return false
    if (system == null) return true
    const descriptor = emulatorById(state.id)
    return descriptor != null && supportsSystem(descriptor, system)
  })
  return usable.find((state) => state.id === preferredId) ?? usable[0] ?? null
}

export type {
  DirBase,
  DirSpec,
  EmulationPaths,
  EmulatorDescriptor,
  EmulatorId,
  EmulatorRole,
  EmulatorState,
  InstallSpec,
  LaunchContext,
  ResolvedInstall,
  SaveLayout
} from './types.ts'

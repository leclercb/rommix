import { eden } from './eden.ts'
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
export const EMULATORS: readonly EmulatorDescriptor[] = [retrodeck, retroarch, eden]

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

export interface EmulatorChoice {
  /** The global default, from settings. */
  preferred: EmulatorId
  /** A pin for this system, from `settings.systemEmulators`. */
  pinned?: EmulatorId
  /** ES-DE system the ROM belongs to, when one is known. */
  system?: string
}

/**
 * Pick the emulator to use.
 *
 * `system` narrows the candidates to emulators that actually run it. Without
 * it the fallback would happily hand an SNES ROM to a Switch emulator, which
 * is the failure mode a flat "preferred runner" setting invites once there is
 * more than one standalone emulator installed.
 *
 * A `pinned` emulator is honoured **strictly**: if it is not usable the answer
 * is null, not a silent substitution. A frontend delegates every system, so it
 * would otherwise win every fallback and quietly swallow the pin — which is
 * exactly the case a user pins to escape, e.g. routing Switch to Eden because
 * their frontend has no Switch emulator behind it.
 */
export function chooseEmulator(
  states: readonly EmulatorState[],
  choice: EmulatorChoice
): EmulatorState | null {
  const { preferred, pinned, system } = choice
  const usable = states.filter((state) => {
    if (!state.available) return false
    if (system == null) return true
    const descriptor = emulatorById(state.id)
    return descriptor != null && supportsSystem(descriptor, system)
  })

  if (pinned != null) return usable.find((state) => state.id === pinned) ?? null
  return usable.find((state) => state.id === preferred) ?? usable[0] ?? null
}

export { eden } from './eden.ts'
export { retroarch } from './retroarch.ts'
export { retrodeck } from './retrodeck.ts'

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

import { eden } from './eden.ts'
import { retroarch } from './retroarch.ts'
import { retrodeck } from './retrodeck.ts'
import type { EmulatorDescriptor, EmulatorId, EmulatorState } from './types.ts'

/**
 * Every emulator RomMix knows how to drive.
 *
 * Order is meaningful: it is the tie-break when RomMix has to pick one for the
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
  /**
   * Emulators in the user's order of preference. The first one that is
   * installed *and* runs the system wins, so an entry that cannot run a
   * particular system simply does not apply to it — no emulator has to be
   * capable of everything to sit at the top.
   */
  priority: readonly EmulatorId[]
  /** A pin for this system, from `settings.systemEmulators`. */
  pinned?: EmulatorId
  /** ES-DE system the ROM belongs to, when one is known. */
  system?: string
}

/**
 * Pick the emulator to use.
 *
 * `system` narrows the candidates to emulators that actually run it. Without
 * it the choice would happily hand an SNES ROM to a Switch emulator, which is
 * the failure mode a flat "preferred runner" setting invites once there is
 * more than one standalone emulator installed.
 *
 * The ordered list is what makes this explainable. A single global "preferred
 * emulator" cannot answer either of the questions that matter — what happens
 * when it does not run this system, and which of two emulators for the *same*
 * system wins — because both answers are an order, not a single value.
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
  const { priority, pinned, system } = choice
  const usable = states.filter((state) => {
    if (!state.available) return false
    if (system == null) return true
    const descriptor = emulatorById(state.id)
    return descriptor != null && supportsSystem(descriptor, system)
  })

  if (pinned != null) return usable.find((state) => state.id === pinned) ?? null

  for (const id of priority) {
    const hit = usable.find((state) => state.id === id)
    if (hit) return hit
  }
  // Anything the user has never ordered falls back to registry order, so a
  // newly added emulator is usable before it is ever configured.
  return usable[0] ?? null
}

/**
 * The stored priority, with any emulator missing from it appended in registry
 * order. Keeps a saved list valid across RomMix versions that add emulators.
 */
export function normalisePriority(stored: readonly EmulatorId[]): EmulatorId[] {
  const known = stored.filter((id) => emulatorById(id) != null)
  return [...known, ...EMULATORS.map((e) => e.id).filter((id) => !known.includes(id))]
}

/** How many systems this emulator covers, for display. */
export function systemCount(emulator: EmulatorDescriptor): number | 'all' {
  return emulator.systems === 'delegated' ? 'all' : emulator.systems.length
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

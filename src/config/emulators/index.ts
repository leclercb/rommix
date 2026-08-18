import { eden } from './eden.ts'
import { retroarch } from './retroarch.ts'
import { retrodeck } from './retrodeck.ts'
import type { EmulatorDescriptor, EmulatorId, EmulatorState } from './types.ts'

/**
 * Every emulator RomMix knows how to drive.
 *
 * Order is meaningful: it is the default answer to "which emulator for this
 * system", so frontends come first — RetroDECK already encodes the user's own
 * per-system emulator setup, and a standalone emulator is what covers the
 * systems no frontend does.
 */
export const EMULATORS: readonly EmulatorDescriptor[] = [retrodeck, retroarch, eden]

export function emulatorById(id: EmulatorId): EmulatorDescriptor | null {
  return EMULATORS.find((emulator) => emulator.id === id) ?? null
}

/** Can this emulator run this ES-DE system? */
export function supportsSystem(emulator: EmulatorDescriptor, system: string): boolean {
  return emulator.systems.includes(system)
}

export function emulatorsForSystem(system: string): EmulatorDescriptor[] {
  return EMULATORS.filter((emulator) => supportsSystem(emulator, system))
}

/**
 * The emulator RomMix uses for a system when the user has not chosen one.
 *
 * Registry order is the "standard configuration" answer. This is deliberately
 * a *static* result — it does not consider what happens to be installed — so
 * the default shown in Settings is a stable fact about the system rather than
 * something that moves as emulators come and go.
 */
export function defaultEmulatorFor(system: string): EmulatorId | null {
  return EMULATORS.find((emulator) => supportsSystem(emulator, system))?.id ?? null
}

/**
 * Resolve the emulator for a system.
 *
 * A recorded choice is honoured **strictly**: if it is not usable the answer is
 * null, not a silent substitution. Being told "Eden is not installed" is far
 * more useful than a Switch ROM quietly failing inside something else.
 *
 * With nothing chosen, the first *available* emulator that runs the system
 * wins, so an uninstalled default degrades to something that works instead of
 * a dead end. Candidates are always filtered by the system first — that is
 * what stops an SNES ROM ever reaching a Switch emulator.
 */
export function resolveEmulator(
  states: readonly EmulatorState[],
  system: string | undefined,
  chosen: Readonly<Record<string, EmulatorId>> = {}
): EmulatorState | null {
  const usable = states.filter((state) => {
    if (!state.available) return false
    if (system == null) return true
    const descriptor = emulatorById(state.id)
    return descriptor != null && supportsSystem(descriptor, system)
  })

  const pick = system ? chosen[system] : undefined
  if (pick != null) return usable.find((state) => state.id === pick) ?? null

  return usable[0] ?? null
}

/** How many systems this emulator covers, for display. */
export function systemCount(emulator: EmulatorDescriptor): number {
  return emulator.systems.length
}

/**
 * Is this release asset something RomMix could actually run?
 *
 * An exact suffix, never a substring. Eden publishes an `.AppImage.zsync`
 * update manifest beside every `.AppImage`, and a substring test offers both —
 * installing the manifest would leave a few kilobytes of metadata sitting
 * where the emulator should be.
 */
export function isInstallableAsset(assetName: string, suffix: string): boolean {
  return assetName.endsWith(suffix)
}

export { eden } from './eden.ts'
export { retroarch } from './retroarch.ts'
export { retrodeck } from './retrodeck.ts'

export type {
  DirBase,
  DirSpec,
  EmulationPaths,
  EmulatorDescriptor,
  EmulatorDispatch,
  EmulatorId,
  EmulatorState,
  InstallSpec,
  LaunchContext,
  ReleaseSource,
  ResolvedInstall,
  SaveLayout
} from './types.ts'

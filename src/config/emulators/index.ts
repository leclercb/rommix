import { eden } from './eden/index.ts'
import { emudeck } from './emudeck/index.ts'
import { retroarch } from './retroarch/index.ts'
import { retrodeck } from './retrodeck/index.ts'
import type {
  EmulatorDescriptor,
  EmulatorId,
  EmulatorState,
  LaunchVariant
} from './types.ts'

/**
 * Every emulator RomMix knows how to drive.
 *
 * Order is meaningful: it is the default answer to "which emulator for this
 * system", so the two that manage a whole emulation setup come first —
 * RetroDECK and EmuDeck already encode the user's own per-system arrangement,
 * and a standalone emulator is what covers the systems neither does.
 */
export const EMULATORS: readonly EmulatorDescriptor[] = [retrodeck, emudeck, retroarch, eden]

/**
 * Directories an AppImage is plausibly sitting in, relative to the user's home.
 *
 * An AppImage is a loose file rather than an install, so there is nothing to
 * query — it has to be looked for where people put them.
 */
export const APPIMAGE_SEARCH_DIRS: readonly (readonly string[])[] = [
  ['Applications'],
  ['.local', 'bin'],
  ['.local', 'share', 'applications'],
  ['Downloads'],
  ['bin']
]

export function emulatorById(id: EmulatorId): EmulatorDescriptor | null {
  return EMULATORS.find((emulator) => emulator.id === id) ?? null
}

/** Can this emulator run this ES-DE system? */
export function supportsSystem(emulator: EmulatorDescriptor, system: string): boolean {
  return emulator.systems.includes(system)
}

/**
 * Every emulator, most preferred first.
 *
 * `priority` is the user's own order from Settings. Anything it does not name
 * keeps its registry position *behind* those it does, so a list written when
 * RomMix shipped three emulators does not hide the fourth — it lands at the
 * end, which is where an unranked thing belongs, rather than vanishing.
 */
export function orderedEmulators(
  priority: readonly EmulatorId[] = []
): readonly EmulatorDescriptor[] {
  if (priority.length === 0) return EMULATORS
  const rank = (emulator: EmulatorDescriptor): number => {
    const index = priority.indexOf(emulator.id)
    return index === -1 ? priority.length + EMULATORS.indexOf(emulator) : index
  }
  return [...EMULATORS].sort((a, b) => rank(a) - rank(b))
}

export function emulatorsForSystem(
  system: string,
  priority: readonly EmulatorId[] = []
): EmulatorDescriptor[] {
  return orderedEmulators(priority).filter((emulator) => supportsSystem(emulator, system))
}

/**
 * The emulator RomMix uses for a system when the user has not chosen one.
 *
 * The first in preference order that covers the system. Deliberately a *static*
 * result — it does not consider what happens to be installed — so the default
 * shown in Settings is a stable fact about the arrangement rather than
 * something that moves as emulators come and go.
 */
export function defaultEmulatorFor(
  system: string,
  priority: readonly EmulatorId[] = []
): EmulatorId | null {
  return emulatorsForSystem(system, priority)[0]?.id ?? null
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
 * The ways an emulator can run a system.
 *
 * Empty when there is nothing to choose between — which is most of them, and is
 * why callers should treat "fewer than two" as "just launch it" rather than
 * showing a dialog with one button in it.
 */
export function launchVariants(
  emulator: EmulatorDescriptor,
  system: string
): readonly LaunchVariant[] {
  return emulator.variants?.(system) ?? []
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

export { eden } from './eden/index.ts'
export { emudeck, EMUDECK_LAUNCHERS, emuDeckLaunchers } from './emudeck/index.ts'
export { retroarch } from './retroarch/index.ts'
export { retrodeck, RETRODECK_APP_ID } from './retrodeck/index.ts'
export { retroDeckComponent } from './retrodeck/saves.ts'
export { emuDeckSaveFolder } from './emudeck/saves.ts'
export { switchTitleId, switchProfileDir } from './switch-saves.ts'
export { coreLibraryName, readRetroArchConfig } from './libretro.ts'
export { baseName, dirName, joinPath } from './savepaths.ts'
export { SAVE_CONVENTIONS } from './saves.ts'

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
  LaunchVariant,
  LayoutDiscovery,
  LayoutSource,
  ReleaseSource,
  ResolvedInstall,
  SaveFileConventions
} from './types.ts'

export type {
  SaveContext,
  SaveEnvironment,
  SaveLocation,
  SaveMatch,
  SavePaths
} from './savepaths.ts'

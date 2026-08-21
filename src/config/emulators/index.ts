import { eden } from './eden/index.ts'
import { emudeck } from './emudeck/index.ts'
import { retroarch } from './retroarch/index.ts'
import { retrodeck } from './retrodeck/index.ts'
import { shadps4 } from './shadps4/index.ts'
import type {
  EmulatorDescriptor,
  EmulatorId,
  EmulatorState,
  InstallSpec,
  LaunchVariant,
  ReleaseSource
} from './types.ts'

/**
 * Every emulator RomMix knows how to drive.
 *
 * Order is meaningful: it is the default answer to "which emulator for this
 * system", so the two that manage a whole emulation setup come first —
 * RetroDECK and EmuDeck already encode the user's own per-system arrangement,
 * and a standalone emulator is what covers the systems neither does.
 */
export const EMULATORS: readonly EmulatorDescriptor[] = [
  retrodeck,
  emudeck,
  retroarch,
  eden,
  shadps4
]

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
 * The ways RomMix can put this emulator on the machine, in the descriptor's own
 * order of preference.
 *
 * Derived from the install list rather than declared beside it: a route that
 * cannot be detected is a route that would install an emulator RomMix then
 * reports as missing, and one that cannot be installed is `binary` or
 * `scripts` — something the user set up themselves and RomMix only finds.
 */
export function installMethods(
  descriptor: EmulatorDescriptor
): readonly (InstallSpec & { kind: 'flatpak' | 'appimage' })[] {
  return descriptor.install.filter(
    (spec): spec is InstallSpec & { kind: 'flatpak' | 'appimage' } =>
      spec.kind === 'flatpak' || spec.kind === 'appimage'
  )
}

/** Where this emulator publishes the builds RomMix can download, if it does. */
export function releaseSource(descriptor: EmulatorDescriptor): ReleaseSource | null {
  const spec = descriptor.install.find((entry) => entry.kind === 'appimage')
  return spec?.kind === 'appimage' ? spec.release : null
}

/**
 * Is this release asset something RomMix could actually run here?
 *
 * One anchored pattern per source, because "the Linux build" is not a suffix:
 * Eden publishes an `.AppImage.zsync` update manifest beside every
 * `.AppImage`, and shadPS4 gives Windows, macOS and Linux the same `.zip`.
 */
export function isInstallableAsset(assetName: string, source: ReleaseSource): boolean {
  return source.asset.test(assetName)
}

export { eden } from './eden/index.ts'
export { emudeck, EMUDECK_LAUNCHERS, emuDeckLaunchers } from './emudeck/index.ts'
export { retroarch } from './retroarch/index.ts'
export { retrodeck, RETRODECK_APP_ID } from './retrodeck/index.ts'
export { retroDeckComponent } from './retrodeck/saves.ts'
export { emuDeckSaveFolder } from './emudeck/saves.ts'
export { switchTitleId, switchProfileDir } from './switch-saves.ts'
export { coreLibraryName, readLibretroConfig } from './libretro.ts'
export { baseName, dirName, joinPath } from './savepaths.ts'
export { SAVE_CONVENTIONS } from './saves.ts'

export type {
  CoreContext,
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
  RequiredCore,
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

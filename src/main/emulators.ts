import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMULATORS, RETRODECK_APP_ID, RETRODECK_CONFIG } from '@config/emulators'
import type {
  DirBase,
  DirSpec,
  EmulationPaths,
  EmulatorDescriptor,
  EmulatorState,
  ResolvedInstall
} from '@config/emulators'
import type { Settings } from '@shared/types'
import { managedEmulatorDir } from './releases'
import { rootPaths } from './root'
import {
  binaryPath,
  findAppImage,
  findMatchingFile,
  flatpakInstalled,
  realHome,
  xdgConfigHome,
  xdgDataHome
} from './host'

/**
 * Probing the machine for the emulators in the registry.
 *
 * The registry says what an emulator *is*; this says whether it is here, and
 * where it put its folders. Most emulators can be described declaratively with
 * a `dirs` template, so this file only needs a special case for the ones that
 * store their layout in their own configuration.
 */

const NO_PATHS: EmulationPaths = { home: null, roms: null, saves: null, states: null, bios: null }

// ---------------------------------------------------------------------------
// Installs
// ---------------------------------------------------------------------------

/**
 * Find the first way this emulator is installed, or null if it is not.
 *
 * An explicit path in settings wins outright: it is the escape hatch for an
 * AppImage kept somewhere RomMix would never think to look.
 */
async function resolveInstall(
  descriptor: EmulatorDescriptor,
  settings: Settings
): Promise<ResolvedInstall | null> {
  const configured = settings.emulatorPaths[descriptor.id]
  if (configured && existsSync(configured)) {
    return configured.toLowerCase().endsWith('.appimage')
      ? { kind: 'appimage', ref: configured }
      : { kind: 'binary', ref: configured }
  }

  // Anything RomMix installed itself, before the generic search. A recorded
  // path goes stale the moment the RomMix folder is renamed or moved, and
  // re-finding the emulator where RomMix actually puts them beats falling
  // through to a stray copy in ~/Downloads — or reporting it as missing when
  // it is sitting right there.
  for (const spec of descriptor.install) {
    if (spec.kind !== 'appimage') continue
    const managed = await findMatchingFile(managedEmulatorDir(descriptor.id), spec.patterns)
    if (managed) return { kind: 'appimage', ref: managed }
  }

  for (const spec of descriptor.install) {
    if (spec.kind === 'flatpak') {
      if (await flatpakInstalled(spec.appId)) return { kind: 'flatpak', ref: spec.appId }
    } else if (spec.kind === 'binary') {
      const path = await binaryPath(spec.names)
      if (path) return { kind: 'binary', ref: path }
    } else {
      const path = await findAppImage(spec.patterns)
      if (path) return { kind: 'appimage', ref: path }
    }
  }
  return null
}

/**
 * Where a `DirSpec` base lands for a given install. A flatpak keeps config and
 * data inside its own per-app tree; a native install uses the XDG roots.
 */
function baseDirs(install: ResolvedInstall): Record<DirBase, string> {
  const home = realHome()
  const rommix = rootPaths().root
  if (install.kind === 'flatpak') {
    const app = join(home, '.var', 'app', install.ref)
    return { home, rommix, config: join(app, 'config'), data: join(app, 'data') }
  }
  return { home, rommix, config: xdgConfigHome(), data: xdgDataHome() }
}

/** Resolve a descriptor's declared path templates against a found install. */
function declaredPaths(descriptor: EmulatorDescriptor, install: ResolvedInstall): EmulationPaths {
  const bases = baseDirs(install)
  const resolve = (spec: DirSpec | undefined): string | null =>
    spec ? join(bases[spec.base], spec.path) : null

  return {
    // No emulator declares `home`; it is only shown in diagnostics, so the
    // config root is the most useful thing to point at.
    home: resolve(descriptor.dirs.home) ?? bases.config,
    roms: resolve(descriptor.dirs.roms),
    saves: resolve(descriptor.dirs.saves),
    states: resolve(descriptor.dirs.states),
    bios: resolve(descriptor.dirs.bios)
  }
}

// ---------------------------------------------------------------------------
// RetroDECK, which keeps its layout in its own config
// ---------------------------------------------------------------------------

interface RetroDeckConfig {
  paths?: Record<string, string>
}

/**
 * Discover RetroDECK's folder layout.
 *
 * The ROM root is user-selectable (internal storage vs SD card), so it has to
 * be read rather than assumed — hardcoding ~/retrodeck would silently put ROMs
 * where RetroDECK never looks. Which files to read and what the keys are called
 * is `RETRODECK_CONFIG`; this only does the reading, newest format first.
 */
function retroDeckPaths(): EmulationPaths {
  const { configDir, json, legacy, fallback } = RETRODECK_CONFIG
  const dir = join(realHome(), '.var', 'app', RETRODECK_APP_ID, ...configDir)

  const jsonPath = join(dir, json.file)
  if (existsSync(jsonPath)) {
    try {
      const config = JSON.parse(readFileSync(jsonPath, 'utf8')) as RetroDeckConfig
      const paths = config.paths ?? {}
      if (paths[json.keys.roms]) {
        return {
          home: paths[json.keys.home] ?? null,
          roms: paths[json.keys.roms],
          saves: paths[json.keys.saves] ?? null,
          states: paths[json.keys.states] ?? null,
          bios: paths[json.keys.bios] ?? null
        }
      }
    } catch {
      // fall through to the legacy format
    }
  }

  const legacyPath = join(dir, legacy.file)
  if (existsSync(legacyPath)) {
    try {
      const values = new Map<string, string>()
      for (const line of readFileSync(legacyPath, 'utf8').split('\n')) {
        const match = /^([a-z_]+)=(.*)$/.exec(line.trim())
        if (match) values.set(match[1], match[2])
      }
      const home = values.get(legacy.homeKey)
      if (home) {
        return {
          home,
          roms: values.get(legacy.keys.roms) ?? join(home, fallback.roms),
          saves: values.get(legacy.keys.saves) ?? join(home, fallback.saves),
          states: values.get(legacy.keys.states) ?? join(home, fallback.states),
          bios: values.get(legacy.keys.bios) ?? join(home, fallback.bios)
        }
      }
    } catch {
      // fall through to the default layout
    }
  }

  // Last resort: the default location, and only if it really exists —
  // reporting "not configured" beats inventing a path.
  const home = join(realHome(), fallback.home)
  if (!existsSync(home)) return NO_PATHS
  return {
    home,
    roms: join(home, fallback.roms),
    saves: join(home, fallback.saves),
    states: join(home, fallback.states),
    bios: join(home, fallback.bios)
  }
}

/**
 * Emulators whose folders cannot be expressed as a template, because they are
 * chosen by the user and recorded in the emulator's own configuration.
 */
const PATH_PROBES: Readonly<Record<string, () => EmulationPaths>> = {
  retrodeck: retroDeckPaths
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async function probe(
  descriptor: EmulatorDescriptor,
  settings: Settings
): Promise<EmulatorState> {
  const install = await resolveInstall(descriptor, settings)
  const specialProbe = PATH_PROBES[descriptor.id]
  const paths = !install
    ? NO_PATHS
    : specialProbe
      ? specialProbe()
      : declaredPaths(descriptor, install)

  // An emulator that owns its library is only useful once that library exists;
  // before that there is nowhere to install to.
  const unavailableReason = !install
    ? `${descriptor.name} is not installed.`
    : descriptor.ownsLibrary && !paths.roms
      ? `${descriptor.name} has not been run yet, so its folders do not exist.`
      : null

  return {
    id: descriptor.id,
    name: descriptor.name,
    dispatch: descriptor.dispatch,
    saveLayout: descriptor.saveLayout,
    saveTree: descriptor.saveTree,
    available: unavailableReason === null,
    install,
    paths,
    unavailableReason
  }
}

/** Probe every registered emulator and report what is usable right now. */
export function detectEmulators(settings: Settings): Promise<EmulatorState[]> {
  return Promise.all(EMULATORS.map((descriptor) => probe(descriptor, settings)))
}

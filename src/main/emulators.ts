import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMULATORS } from '@shared/emulators'
import { RETRODECK_APP_ID } from '@shared/emulators/retrodeck.ts'
import type {
  DirBase,
  DirSpec,
  EmulationPaths,
  EmulatorDescriptor,
  EmulatorState,
  ResolvedInstall
} from '@shared/emulators'
import type { Settings } from '@shared/types'
import {
  appImageWrapper,
  binaryPath,
  findAppImage,
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
      ? { kind: 'appimage', ref: configured, wrapper: await appImageWrapper() }
      : { kind: 'binary', ref: configured }
  }

  for (const spec of descriptor.install) {
    if (spec.kind === 'flatpak') {
      if (await flatpakInstalled(spec.appId)) return { kind: 'flatpak', ref: spec.appId }
    } else if (spec.kind === 'binary') {
      const path = await binaryPath(spec.names)
      if (path) return { kind: 'binary', ref: path }
    } else {
      const path = await findAppImage(spec.patterns)
      if (path) return { kind: 'appimage', ref: path, wrapper: await appImageWrapper() }
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
  if (install.kind === 'flatpak') {
    const app = join(home, '.var', 'app', install.ref)
    return { home, config: join(app, 'config'), data: join(app, 'data') }
  }
  return { home, config: xdgConfigHome(), data: xdgDataHome() }
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

/** Where RetroDECK keeps its own configuration inside its flatpak data dir. */
export function retroDeckConfigDir(): string {
  return join(realHome(), '.var', 'app', RETRODECK_APP_ID, 'config', 'retrodeck')
}

/**
 * Discover RetroDECK's folder layout.
 *
 * Modern RetroDECK stores everything in retrodeck.json; older builds used a
 * flat `key=value` retrodeck.cfg. Both are read because a user's install may
 * predate the migration. The paths matter: the ROM root is user-selectable
 * (internal storage vs SD card), so hardcoding ~/retrodeck would silently put
 * ROMs where RetroDECK never looks.
 */
export function retroDeckPaths(): EmulationPaths {
  const configDir = retroDeckConfigDir()

  const jsonPath = join(configDir, 'retrodeck.json')
  if (existsSync(jsonPath)) {
    try {
      const cfg = JSON.parse(readFileSync(jsonPath, 'utf8')) as RetroDeckConfig
      const p = cfg.paths ?? {}
      if (p.roms_path) {
        return {
          home: p.rd_home_path ?? null,
          roms: p.roms_path,
          saves: p.saves_path ?? null,
          states: p.states_path ?? null,
          bios: p.bios_path ?? null
        }
      }
    } catch {
      // fall through to the legacy format
    }
  }

  const cfgPath = join(configDir, 'retrodeck.cfg')
  if (existsSync(cfgPath)) {
    try {
      const values = new Map<string, string>()
      for (const line of readFileSync(cfgPath, 'utf8').split('\n')) {
        const match = /^([a-z_]+)=(.*)$/.exec(line.trim())
        if (match) values.set(match[1], match[2])
      }
      const home = values.get('rdhome') ?? null
      if (home) {
        return {
          home,
          roms: values.get('roms_folder') ?? join(home, 'roms'),
          saves: values.get('saves_folder') ?? join(home, 'saves'),
          states: values.get('states_folder') ?? join(home, 'states'),
          bios: values.get('bios_folder') ?? join(home, 'bios')
        }
      }
    } catch {
      // fall through to the default layout
    }
  }

  // Last resort: RetroDECK's default location. Only usable if it really exists,
  // otherwise we would rather report "not configured" than invent a path.
  const fallback = join(realHome(), 'retrodeck')
  if (existsSync(fallback)) {
    return {
      home: fallback,
      roms: join(fallback, 'roms'),
      saves: join(fallback, 'saves'),
      states: join(fallback, 'states'),
      bios: join(fallback, 'bios')
    }
  }

  return NO_PATHS
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

function applyOverrides(paths: EmulationPaths, overrides: Partial<EmulationPaths>): EmulationPaths {
  return {
    home: overrides.home ?? paths.home,
    roms: overrides.roms ?? paths.roms,
    saves: overrides.saves ?? paths.saves,
    states: overrides.states ?? paths.states,
    bios: overrides.bios ?? paths.bios
  }
}

async function probe(
  descriptor: EmulatorDescriptor,
  settings: Settings
): Promise<EmulatorState> {
  const install = await resolveInstall(descriptor, settings)
  const specialProbe = PATH_PROBES[descriptor.id]
  const discovered = !install
    ? NO_PATHS
    : specialProbe
      ? specialProbe()
      : declaredPaths(descriptor, install)
  const paths = applyOverrides(discovered, settings.pathOverrides)

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
    role: descriptor.role,
    saveLayout: descriptor.saveLayout,
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

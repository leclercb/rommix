import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMULATORS } from '@config/emulators'
import type {
  DirBase,
  DirSpec,
  EmulationPaths,
  EmulatorDescriptor,
  EmulatorState,
  LayoutSource,
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
 * where it put its folders. Nothing in this file names an emulator: one whose
 * folders are fixed declares a `dirs` template, and one whose folders the user
 * chose declares where it writes that choice down (`layout`). Adding an
 * emulator is therefore a file in `src/config/emulators/` and nothing here.
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
    } else if (spec.kind === 'appimage') {
      const path = await findAppImage(spec.patterns)
      if (path) return { kind: 'appimage', ref: path }
    } else {
      // A set of launcher scripts, somewhere the emulator's own configuration
      // points at. Discovery runs without an install, which is exactly the
      // position it is in: the directory it finds *is* the install.
      const { paths, extras } = discoverLayout(descriptor, null)
      const root = extras[spec.dir.from] ?? paths[spec.dir.from as keyof EmulationPaths]
      if (!root) continue
      const dir = join(root, spec.dir.path)
      if (existsSync(dir)) return { kind: 'scripts', ref: dir }
    }
  }
  return null
}

/**
 * Where a `DirSpec` base lands for a given install. A flatpak keeps config and
 * data inside its own per-app tree; a native install — or no install yet, while
 * one is still being looked for — uses the XDG roots.
 */
function baseDirs(install: ResolvedInstall | null): Record<DirBase, string> {
  const home = realHome()
  const rommix = rootPaths().root
  if (install?.kind === 'flatpak') {
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
// Emulators that record their own layout
// ---------------------------------------------------------------------------

/**
 * Values out of one configuration file.
 *
 * Two formats cover what emulators actually write: `key=value` shell, and JSON
 * with the paths under one property. Nothing here knows which emulator it is
 * reading for — the descriptor said where the file is and what its keys are
 * called, and this only does the reading.
 */
function readConfigValues(path: string, source: LayoutSource): Map<string, string> {
  const values = new Map<string, string>()
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return values
  }

  if (source.format === 'json') {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const section = source.section
        ? (parsed[source.section] as Record<string, unknown> | undefined)
        : parsed
      for (const [key, value] of Object.entries(section ?? {})) {
        if (typeof value === 'string' && value) values.set(key, value)
      }
    } catch {
      // Malformed: treated as absent, so the next source gets its turn.
    }
    return values
  }

  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    // Quotes and a leading $HOME are both things these files carry.
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (value) values.set(match[1], value.replace(/^\$HOME|^~/, realHome()))
  }
  return values
}

/**
 * Work out an emulator's folders from its own configuration.
 *
 * `install` is null while resolving an install that is itself defined by these
 * paths, which is fine: a descriptor in that position reads a file under the
 * user's home rather than inside an application's own tree.
 *
 * Returns the standard paths plus any extras the descriptor asked for, which
 * are how an install spec names a directory that is not one of ours.
 */
function discoverLayout(
  descriptor: EmulatorDescriptor,
  install: ResolvedInstall | null
): { paths: EmulationPaths; extras: Record<string, string> } {
  const found = new Map<string, string>()
  const layout = descriptor.layout
  const bases = baseDirs(install)

  for (const source of layout?.sources ?? []) {
    const file = join(bases[source.file.base], source.file.path)
    if (!existsSync(file)) continue

    const values = readConfigValues(file, source)
    const names: Record<string, string> = { ...source.keys, ...source.extras }
    const fromFile = new Map<string, string>()
    for (const [ours, theirs] of Object.entries(names)) {
      const value = values.get(theirs)
      if (value) fromFile.set(ours, value)
    }
    // A file that exists but does not carry the name that matters is an older
    // or half-written one: skipped, so a later source still gets its turn.
    if (!fromFile.has(source.requires)) continue

    // Anything the file left out hangs off the home *it* gave, so a library on
    // an SD card does not fall back to one in the home directory.
    const home = fromFile.get('home')
    if (home) {
      for (const [ours, relative] of Object.entries(source.defaults ?? {})) {
        if (!fromFile.has(ours)) fromFile.set(ours, join(home, relative))
      }
    }
    for (const [key, value] of fromFile) found.set(key, value)
    break
  }

  // Guessed locations are used only where they exist. A plausible-but-wrong
  // path would turn "never set up" into a silent install into a dead folder.
  for (const [ours, relative] of Object.entries(layout?.fallback?.paths ?? {})) {
    if (found.has(ours)) continue
    const candidate = join(bases[layout!.fallback!.base], relative)
    if (existsSync(candidate)) found.set(ours, candidate)
  }

  const path = (key: keyof EmulationPaths): string | null => found.get(key) ?? null
  const extras: Record<string, string> = {}
  for (const [key, value] of found) {
    if (!(key in NO_PATHS)) extras[key] = value
  }

  return {
    paths: {
      home: path('home'),
      roms: path('roms'),
      saves: path('saves'),
      states: path('states'),
      bios: path('bios')
    },
    extras
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async function probe(
  descriptor: EmulatorDescriptor,
  settings: Settings
): Promise<EmulatorState> {
  const install = await resolveInstall(descriptor, settings)
  const paths = !install
    ? NO_PATHS
    : descriptor.layout
      ? discoverLayout(descriptor, install).paths
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

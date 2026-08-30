import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchVariants, orderedEmulators } from '@config/emulators'
import type {
  DirBase,
  DirSpec,
  EmulationPaths,
  EmulatorDescriptor,
  EmulatorState,
  LaunchVariant,
  LayoutSource,
  ResolvedInstall
} from '@config/emulators'
import type { Settings } from '@shared/types'
import { log } from './log.ts'
import { managedEmulatorDir } from './releases.ts'
import { rootPaths } from './root.ts'
import { binaryPath, findAppImage, findMatchingFile, flatpakLocation } from './host.ts'
import { realHome, xdgConfigHome, xdgDataHome } from './xdg.ts'
import { t } from './i18n.ts'

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
      const location = await flatpakLocation(spec.appId)
      if (location) return { kind: 'flatpak', ref: spec.appId, location }
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
      const { paths, extras } = discoverLayout(descriptor, null, settings)
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
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    const raw = match[2].trim()
    if (!raw) continue
    // Quotes are the reader's business, not something to strip beforehand:
    // where they open and close is what decides whether a `$` expands.
    const value = expandShell(raw, values)
    // A value still naming something unresolved is dropped rather than used: a
    // ROM folder called `$emulationPath` is worse than no ROM folder, because
    // the second is reported and the first is silently created.
    if (value !== null) values.set(match[1], value)
  }
  return values
}

/**
 * Read one value out of a shell settings file, as sourcing it would.
 *
 * These files are *sourced* by the emulator's own scripts, so every form the
 * shell understands is legal in them, and EmuDeck uses several in the same
 * file — `romsPath="$emulationPath/roms"` fully quoted, and
 * `emulationPath="$HOME"/Emulation` with the quotes around the variable only.
 *
 * That second form is why this walks the string rather than trimming a quote
 * off each end and expanding what is left. Stripping the outermost pair leaves
 * an opening quote with no closing one, and the `"` in the middle of the value
 * survives into the path: `/home/user"/Emulation`, a directory that cannot
 * exist, reported as the library root of an EmuDeck install that is sitting
 * right there.
 *
 * What the shell does, and so what this does: quotes delimit rather than
 * belong; `$name` and `${name}` expand unless single-quoted; `~` is home only
 * at the very front and only unquoted; an unquoted space ends the value, since
 * that is where the assignment ends and the next word begins.
 *
 * Only backward references are resolved, which is what sourcing does too: a
 * name is whatever it was last assigned above this line. `HOME` is supplied
 * from the environment because the file does not assign it. Anything left
 * unresolved makes the whole value null rather than a path with a `$` in it.
 */
export function expandShell(value: string, known: ReadonlyMap<string, string>): string | null {
  const home = realHome()
  let out = ''
  let unresolved = false
  let quote: '"' | "'" | null = null
  let index = 0

  // Before the loop, because this is the one position the shell treats `~`
  // specially — and it is not special inside quotes, which have not opened yet.
  if (value.startsWith('~') && (value.length === 1 || value[1] === '/')) {
    out = home
    index = 1
  }

  for (; index < value.length; index += 1) {
    const char = value[index]

    if (quote === null && (char === '"' || char === "'")) {
      quote = char
      continue
    }
    if (char === quote) {
      quote = null
      continue
    }
    // An unquoted space is the end of the assignment, not part of the path.
    if (quote === null && /\s/.test(char)) break

    // Single quotes are the shell's literal quotes: nothing expands inside them.
    if (char === '$' && quote !== "'") {
      const reference = /^(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(
        value.slice(index + 1)
      )
      if (reference) {
        const name = reference[1] ?? reference[2]
        const found = name === 'HOME' ? home : known.get(name)
        if (found === undefined) unresolved = true
        else out += found
        index += reference[0].length
        continue
      }
    }
    out += char
  }

  return unresolved ? null : out
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
  install: ResolvedInstall | null,
  settings: Settings
): { paths: EmulationPaths; extras: Record<string, string> } {
  const found = new Map<string, string>()
  const layout = descriptor.layout
  const bases = baseDirs(install)

  /**
   * A library folder the user pointed us at wins outright, and the emulator's
   * own configuration is not consulted at all.
   *
   * The two cannot both be believed — "the answer is on disk" and "the user
   * corrected us" would produce a tree half in each place — and the correction
   * is the newer fact. It is also the only thing that helps when the emulator's
   * settings file is somewhere RomMix cannot find, which is exactly the
   * situation that makes someone set this.
   */
  const root = settings.emulatorRoots[descriptor.id]
  if (root && layout?.relative) {
    const paths = { ...NO_PATHS, home: root }
    const extras: Record<string, string> = {}
    for (const [name, child] of Object.entries(layout.relative)) {
      const resolved = join(root, child)
      if (name in NO_PATHS) paths[name as keyof EmulationPaths] = resolved
      else extras[name] = resolved
    }
    return { paths, extras }
  }

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
// Variants
// ---------------------------------------------------------------------------

/**
 * The ways this emulator can really run a system on this machine.
 *
 * `launchVariants` is what the descriptor claims; this is what survives being
 * looked for. The two differ for exactly one kind of install — a directory of
 * launcher scripts, where the option list describes another program's setup
 * choices and RomMix has no say in which of them were made. A row naming a
 * script that is not in that directory describes an emulator this user did not
 * install, or one upstream has since renamed, and offering it produces a launch
 * that fails with nothing on screen explaining why.
 *
 * Every other install kind passes through untouched: a flatpak or an AppImage
 * is one program, and its variants are facts about it rather than about the
 * folder it was found in.
 */
export function usableVariants(
  descriptor: EmulatorDescriptor,
  system: string,
  install: ResolvedInstall | null
): readonly LaunchVariant[] {
  const declared = launchVariants(descriptor, system)
  if (install?.kind !== 'scripts') return declared

  const usable = declared.filter(
    (variant) => !variant.requires || existsSync(join(install.ref, variant.requires))
  )
  // Only when something was dropped, and naming what: this is the line that
  // answers "why is Citron not in the list" without a trip to the filesystem.
  if (usable.length !== declared.length) {
    log.debug('probe', 'launchers not installed', {
      emulator: descriptor.id,
      system,
      dir: install.ref,
      missing: declared.filter((variant) => !usable.includes(variant)).map((variant) => variant.id)
    })
  }
  return usable
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async function probe(descriptor: EmulatorDescriptor, settings: Settings): Promise<EmulatorState> {
  const install = await resolveInstall(descriptor, settings)
  const paths = !install
    ? NO_PATHS
    : descriptor.layout
      ? discoverLayout(descriptor, install, settings).paths
      : declaredPaths(descriptor, install)

  // Where this install keeps its own configuration, which is a different
  // question from where it keeps the emulation library — and the one save
  // resolution asks when it needs to read an emulator's settings.
  const bases = install ? baseDirs(install) : null

  // An emulator that owns its library is only useful once that library exists;
  // before that there is nowhere to install to.
  const unavailableReason = !install
    ? t('emulator.reasonNotInstalled', { name: descriptor.name })
    : descriptor.ownsLibrary && !paths.roms
      ? t('emulator.reasonNotRun', { name: descriptor.name })
      : null

  // What the probe concluded, per emulator: where it was found, and the folders
  // every later decision — where a ROM lands, where its saves are, where a BIOS
  // goes — is made from.
  log.debug('probe', descriptor.id, {
    install: install?.kind ?? null,
    ref: install?.ref ?? null,
    roms: paths.roms,
    saves: paths.saves,
    states: paths.states,
    bios: paths.bios,
    unavailableReason
  })

  return {
    id: descriptor.id,
    name: descriptor.name,
    dispatch: descriptor.dispatch,
    available: unavailableReason === null,
    install,
    paths,
    configDir: bases?.config ?? null,
    dataDir: bases?.data ?? null,
    unavailableReason
  }
}

/** Probe every registered emulator and report what is usable right now. */
export async function detectEmulators(settings: Settings): Promise<EmulatorState[]> {
  // Probed in the user's order, because that order *is* the answer to "which
  // emulator runs this": `resolveEmulator` takes the first available one that
  // covers the system, so sorting here is what makes reordering in Settings
  // change anything at all.
  const took = log.since()
  const states = await Promise.all(
    orderedEmulators(settings.emulatorPriority).map((descriptor) => probe(descriptor, settings))
  )

  // In probe order, which is also priority order: the first entry covering a
  // platform is the one that will run it, so this line answers "why is it
  // launching that one" without reading any of the debug lines above.
  log.info('probe', 'emulators detected', {
    available: states.filter((state) => state.available).map((state) => state.id),
    missing: states.filter((state) => !state.available).map((state) => state.id),
    ms: took()
  })
  return states
}

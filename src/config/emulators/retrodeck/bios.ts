import { joinPath } from '../savepaths.ts'
import type { BiosContext, BiosTarget, EmulationPaths } from '../types.ts'
import { retroDeckComponent } from './saves.ts'

/**
 * Where RetroDECK wants one BIOS file.
 *
 * `~/retrodeck/bios` is not a flat folder. Most firmware does sit at its root,
 * but Flycast reads Dreamcast boot ROMs from `bios/dc`, MAME and MSX keep trees
 * of their own, pico-8 wants `bios/pico-8`, and a GameCube IPL goes into the
 * *saves* tree at `saves/gc/dolphin/<region>` because that is where Dolphin
 * looks. None of that follows from the file or from the platform: it is what
 * the component RetroDECK dispatches the system to happens to want.
 *
 * So it is read rather than guessed. RetroDECK ships a manifest per bundled
 * component listing every BIOS file it knows about — name, hash, systems and,
 * where it is not the default, the folder — and that is the same data its own
 * BIOS checker reads. Anything the manifests do not mention goes to the root,
 * which is both the overwhelming majority and RetroDECK's own default.
 */

/** One `bios` entry of a component manifest. Every field is optional in the wild. */
interface ManifestEntry {
  filename?: string
  system?: string | readonly string[]
  /** Where it goes, when that is not the component's default BIOS folder. */
  paths?: string | readonly string[]
}

/**
 * The manifest of one bundled component, below RetroDECK's deploy directory —
 * the same tree `es_systems.xml` is read from.
 */
function manifestPath(installDir: string, component: string): string {
  return joinPath(
    installDir,
    'files',
    'retrodeck',
    'components',
    component,
    'component_manifest.json'
  )
}

/**
 * Parsed manifests, keyed by the environment that read them.
 *
 * A scan asks about every BIOS file of every platform, and the RetroArch
 * manifest alone holds five hundred entries — parsing it once per file would
 * be the most expensive thing the BIOS screen does. Keyed by the `env` object
 * rather than by path so the cache dies with whatever handed it out, which in
 * a test is one fake machine and in the app is the process.
 */
const CACHE = new WeakMap<object, Map<string, ManifestEntry[]>>()

function entries(ctx: BiosContext, component: string): ManifestEntry[] {
  if (!ctx.installDir) return []
  const path = manifestPath(ctx.installDir, component)

  let byPath = CACHE.get(ctx.env)
  if (!byPath) {
    byPath = new Map()
    CACHE.set(ctx.env, byPath)
  }
  const cached = byPath.get(path)
  if (cached) return cached

  const found = read(ctx.env.text(path))
  byPath.set(path, found)
  return found
}

/**
 * Every `bios` list in a manifest, wherever it sits.
 *
 * Collected by walking rather than by naming the place: RetroArch keeps its
 * list under `cores`, PCSX2 and Dolphin under `preset_actions`, MAME and
 * melonDS at the top level. Following the shape means a component that moves
 * its list, or a new one that puts it somewhere else again, still reads.
 */
function read(text: string | null): ManifestEntry[] {
  if (!text) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }

  const found: ManifestEntry[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'bios' && Array.isArray(value)) found.push(...(value as ManifestEntry[]))
      else walk(value)
    }
  }
  walk(parsed)
  return found
}

/**
 * The roots a manifest path can be written against.
 *
 * Only these four are honoured. RetroDECK's own manifests carry a few
 * mangled ones — `$saves_paths_path`, `$saves_paths_paths_path` — and an
 * unrecognised root has to mean "no answer" rather than a path assembled out
 * of a name RomMix invented a meaning for.
 */
const ROOTS: Readonly<Record<string, keyof EmulationPaths>> = {
  $bios_path: 'bios',
  $roms_path: 'roms',
  $saves_path: 'saves',
  $states_path: 'states'
}

function resolve(spec: string, paths: EmulationPaths): string | null {
  const [head, ...rest] = spec.split('/')
  const key = ROOTS[head]
  const root = key ? paths[key] : null
  if (!root) return null
  return rest.length > 0 ? joinPath(root, ...rest) : root
}

function list(value: string | readonly string[] | undefined): readonly string[] {
  return value == null ? [] : typeof value === 'string' ? [value] : value
}

function matches(entry: ManifestEntry, ctx: BiosContext): boolean {
  if (entry.filename?.toLowerCase() !== ctx.fileName.toLowerCase()) return false
  const systems = list(entry.system)
  // An entry that names no system is about the file alone, and applies.
  return systems.length === 0 || systems.includes(ctx.system)
}

export function retroDeckBiosDir(ctx: BiosContext): BiosTarget {
  const root = ctx.paths.bios
  const component = retroDeckComponent({ ...ctx, romPath: null })

  const entry = entries(ctx, component).find((candidate) => matches(candidate, ctx))
  const declared = list(entry?.paths)
    .map((spec) => resolve(spec, ctx.paths))
    .filter((dir): dir is string => dir !== null)

  // A file listed in several places — `neogeo.zip` is BIOS to Neo Geo and a ROM
  // to three arcade cores — belongs in the BIOS folder as far as this screen is
  // concerned. The others are the same file wanted a second time, not a second
  // file, and copying it into a ROM folder would put an entry in the user's
  // game list.
  //
  // Where none of them is the BIOS folder the first is taken, which is the
  // honest answer to a list RetroDECK itself treats as alternatives: a GameCube
  // IPL is named for `saves/gc/dolphin/EU`, `/US` and `/JP` in one entry, and
  // nothing in the file or the manifest says which region this dump is.
  const inBios = declared.find(
    (dir) => root != null && (dir === root || dir.startsWith(`${root}/`))
  )
  return inBios ?? declared[0] ?? root
}

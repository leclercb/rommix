// Relative, with the extension: this module is imported both by the bundler
// and by Node's TypeScript stripping in the tests, and the latter resolves no
// aliases. `shared/types/` reaches into config the same way.
import { CONTAINER_SYSTEMS, DESCRIPTOR_EXTENSIONS, SIDECAR_EXTENSIONS } from '../config/romfiles.ts'
import type { ContainerFormat } from '../config/romfiles.ts'

/**
 * The file at the end of a path.
 *
 * `basename` without `node:path`, which the renderer has no access to — and the
 * renderer is where every caller is, falling back to the file when RomM has no
 * name for a game. RomMix only ever runs on Linux, so a separator is a slash.
 */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * Deciding which file inside a multi-file game is the one to launch.
 *
 * Emulators take a file, never the directory holding it, so an extracted game
 * needs exactly one of its files nominated. The rule is kept here, separate
 * from the filesystem walk that feeds it, because it is a heuristic applied
 * across ~195 systems and is the part worth testing. Which extensions count
 * as what is data, and lives in `src/config/romfiles.ts`.
 */

/** A file inside an extracted game. */
export interface GameFile {
  name: string
  sizeBytes: number
}

const SIDECARS: ReadonlySet<string> = new Set(SIDECAR_EXTENSIONS)

/** Lowercase extension including the dot, or '' when there is none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/**
 * The file to launch, or null when nothing in the list qualifies.
 *
 * Anything left after the sidecars are dropped and no descriptor is found
 * falls back to the largest file: the game itself is reliably bigger than the
 * manuals and artwork shipped beside it.
 *
 * `system` is the ES-DE system the game belongs to, and is what excuses a
 * handful of them from the descriptor rule — see `CONTAINER_SYSTEMS`. Omitting
 * it asks the question that has always been asked, which is the right one
 * everywhere else.
 */
export function chooseLaunchFile(files: readonly GameFile[], system?: string): string | null {
  const candidates = files.filter((file) => !SIDECARS.has(extensionOf(file.name)))
  if (candidates.length === 0) return null

  const format = system ? CONTAINER_SYSTEMS[system] : undefined
  if (format) {
    const container = chooseContainer(candidates, format)
    // No container at all means this is not the shape the system's rule
    // describes — a homebrew .nro, or a dump in some other format — so the
    // general rule answers instead of nothing being launchable.
    if (container) return container
  }

  for (const wanted of DESCRIPTOR_EXTENSIONS) {
    const hit = candidates.find((file) => extensionOf(file.name) === wanted)
    if (hit) return hit.name
  }

  return largest(candidates).name
}

/**
 * The base game among a container system's files, or null when there is none.
 *
 * Updates and DLC are dropped first, because size cannot separate them: a
 * patch is occasionally the larger download, and one that is not the game
 * boots to nothing whichever way round they came out. When *every* container
 * looks like an add-on the marks are not to be trusted — a filename carrying
 * something that reads like a title id, most likely — and the choice falls
 * back to size across all of them rather than to nothing.
 */
function chooseContainer(candidates: readonly GameFile[], format: ContainerFormat): string | null {
  const containers = candidates.filter((file) => format.extensions.includes(extensionOf(file.name)))
  if (containers.length === 0) return null

  const isAddOn = (name: string): boolean =>
    format.addOnPatterns.some((pattern) => pattern.test(name))
  const base = containers.filter((file) => !isAddOn(file.name))
  return largest(base.length > 0 ? base : containers).name
}

/**
 * Is this a file the system's emulators can be handed at all?
 *
 * Only ever answers no where RomMix knows the whole set of things a game can
 * be — the container systems — since anywhere else the answer would have to be
 * a list of every ROM extension in existence, and a game with an unexpected one
 * would be declared unplayable for no better reason than that.
 */
export function isLaunchable(name: string, system?: string): boolean {
  const format = system ? CONTAINER_SYSTEMS[system] : undefined
  return !format || format.extensions.includes(extensionOf(name))
}

/** The biggest of a non-empty list. */
function largest(files: readonly GameFile[]): GameFile {
  let best = files[0]
  for (const file of files) {
    if (file.sizeBytes > best.sizeBytes) best = file
  }
  return best
}

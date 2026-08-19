// Relative, with the extension: this module is imported both by the bundler
// and by Node's TypeScript stripping in the tests, and the latter resolves no
// aliases. `shared/types.ts` reaches into config the same way.
import { DESCRIPTOR_EXTENSIONS, SIDECAR_EXTENSIONS } from '../config/romfiles.ts'

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
 */
export function chooseLaunchFile(files: readonly GameFile[]): string | null {
  const candidates = files.filter((file) => !SIDECARS.has(extensionOf(file.name)))
  if (candidates.length === 0) return null

  for (const wanted of DESCRIPTOR_EXTENSIONS) {
    const hit = candidates.find((file) => extensionOf(file.name) === wanted)
    if (hit) return hit.name
  }

  let best = candidates[0]
  for (const file of candidates) {
    if (file.sizeBytes > best.sizeBytes) best = file
  }
  return best.name
}

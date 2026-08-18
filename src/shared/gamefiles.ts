/**
 * Deciding which file inside a multi-file game is the one to launch.
 *
 * Emulators take a file, never the directory holding it, so an extracted game
 * needs exactly one of its files nominated. The rule is kept here, separate
 * from the filesystem walk that feeds it, because it is a heuristic applied
 * across ~195 systems and is the part worth testing.
 */

/** A file inside an extracted game. */
export interface GameFile {
  name: string
  sizeBytes: number
}

/** Files that are never the thing you hand an emulator. */
export const SIDECAR_EXTENSIONS: ReadonlySet<string> = new Set([
  '.txt', '.nfo', '.xml', '.dat', '.md5', '.sfv', '.sbi', '.sub', '.ccd', '.jpg', '.jpeg', '.png'
])

/**
 * Disc descriptors, in the order they should be preferred.
 *
 * These must win over the tracks they reference. Handing an emulator the
 * `.bin` of a cue+bin pair loads a headerless track and fails, and a multi-disc
 * set is the `.m3u` rather than any single disc in it — which is also why the
 * playlist outranks the descriptor.
 */
export const DESCRIPTOR_EXTENSIONS: readonly string[] = ['.m3u', '.cue', '.gdi']

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
  const candidates = files.filter((file) => !SIDECAR_EXTENSIONS.has(extensionOf(file.name)))
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

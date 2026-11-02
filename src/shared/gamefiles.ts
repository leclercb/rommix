// Relative, with the extension: this module is imported both by the bundler
// and by Node's TypeScript stripping in the tests, and the latter resolves no
// aliases. `shared/types/` reaches into config the same way.
import {
  ARCHIVE_EXTENSIONS,
  CONTAINER_SYSTEMS,
  DESCRIPTOR_EXTENSIONS,
  IMAGE_ONLY_SYSTEMS,
  ROMSET_SYSTEMS,
  SIDECAR_EXTENSIONS
} from '../config/romfiles.ts'
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
 * The directory a path is in.
 *
 * `dirname` on the same terms as `fileNameOf` above, and for the same callers:
 * the screens that say where a game, a save or a downloaded copy lives on this
 * disk name the folder rather than the file, which is the part a user can go
 * and look in. A path with no directory in front of it is left as it is —
 * there is no folder to name, and inventing one would be a lie about where the
 * file is.
 */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(0, cut)
}

/**
 * What a game on this disk is made of.
 *
 * The index lists it, and an entry that lists nothing is the one file `path`
 * names.
 */
export function localFileNames(entry: { path: string; files?: string[] }): string[] {
  return entry.files?.length ? entry.files : [fileNameOf(entry.path)]
}

/** The folder holding an installed game's files, shared with others or not. */
export function gameFolderOf(entry: { path: string; isDirectory: boolean }): string {
  return entry.isDirectory ? entry.path : folderOf(entry.path)
}

/** What a list of RomM's files adds up to. */
export function bytesOf(files: readonly { file_size_bytes: number }[]): number {
  return files.reduce((sum, file) => sum + file.file_size_bytes, 0)
}

/**
 * The server's files an installed game does not have: an update or a DLC
 * uploaded after the download.
 *
 * Never answers for a game RomM holds as one file, because a copy of that game
 * has nothing left to fetch and its name is no evidence: RomM's `game.zip` is
 * unpacked to a `game.sfc` here. The same goes for that archive once a second
 * file joins it, so an archive whose stem is on this disk is taken as unpacked.
 * By file name alone and whatever the case, since an archive can carry a game a
 * folder deeper than the server's list says it is.
 */
export function newFilesOf<File extends { file_name: string }>(
  serverFiles: readonly File[],
  entry: { path: string; files?: string[] }
): File[] {
  if (serverFiles.length < 2) return []
  const here = new Set(localFileNames(entry).map((name) => fileNameOf(name).toLowerCase()))
  const stems = new Set([...here].map(stemOf))
  return serverFiles.filter((file) => {
    const name = file.file_name.toLowerCase()
    if (here.has(name)) return false
    return !(ARCHIVE_EXTENSIONS.includes(extensionOf(name)) && stems.has(stemOf(name)))
  })
}

/**
 * Deciding which file inside a multi-file game is the one to launch.
 *
 * Emulators take a file, never the directory holding it, so an extracted game
 * needs exactly one of its files nominated. The rule is kept here, separate
 * from the filesystem walk that feeds it, because it is a heuristic applied
 * across every system in `SYSTEMS` and is the part worth testing. Which extensions count
 * as what is data, and lives in `src/config/romfiles.ts`.
 */

/** A file inside an extracted game. */
export interface GameFile {
  name: string
  sizeBytes: number
}

const SIDECARS: ReadonlySet<string> = new Set(SIDECAR_EXTENSIONS)
const ROMSETS: ReadonlySet<string> = new Set(ROMSET_SYSTEMS)

/**
 * Does this system take an archive as the game itself?
 *
 * The question a downloaded archive has to be asked before it is opened. A zip
 * arriving from RomM is usually transport — RomM zips a lone ROM to serve it,
 * and builds one out of a game of several files — and unpacking it is what puts
 * the game where an emulator can find it. On the systems listed in
 * `ROMSET_SYSTEMS` it is the game, and unpacking it destroys it.
 *
 * Nothing in the bytes tells the two apart; both are a zip. The system is the
 * only thing that does, which is why this is asked of it rather than of the
 * file. Without one the answer is no, since every other system's archive is
 * transport.
 */
export function archiveIsTheRom(system?: string): boolean {
  return system !== undefined && ROMSETS.has(system)
}

/** Lowercase extension including the dot, or '' when there is none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/** A name with its extension dropped. */
function stemOf(name: string): string {
  return name.slice(0, name.length - extensionOf(name).length)
}

/**
 * The file to launch, or null when nothing in the list qualifies.
 *
 * Anything left after the sidecars are dropped and no descriptor is found
 * falls back to the largest file: the game itself is reliably bigger than the
 * manuals and artwork shipped beside it.
 *
 * `system` is the ES-DE system the game belongs to, and is what excuses a
 * handful of them from the descriptor rule — see `CONTAINER_SYSTEMS` and
 * `IMAGE_ONLY_SYSTEMS`. Omitting
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

  if (system !== undefined && IMAGE_ONLY_SYSTEMS.includes(system)) {
    const images = candidates.filter(
      (file) => !DESCRIPTOR_EXTENSIONS.includes(extensionOf(file.name))
    )
    return images.length > 0 ? largest(images).name : null
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
 * be — the container systems — or knows a thing it cannot be: a descriptor on
 * a system whose emulators take only the image. Anywhere else the answer would
 * have to be a list of every ROM extension in existence, and a game with an
 * unexpected one would be declared unplayable for no better reason than that.
 */
export function isLaunchable(name: string, system?: string): boolean {
  if (system !== undefined && IMAGE_ONLY_SYSTEMS.includes(system)) {
    return !DESCRIPTOR_EXTENSIONS.includes(extensionOf(name))
  }
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

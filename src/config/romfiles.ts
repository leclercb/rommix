/**
 * What the files inside a game are.
 *
 * Facts about ROM and disc formats rather than about RomMix: which extensions
 * are a disc descriptor, and which are documentation that came along in the
 * archive. Adding a format is an edit here and nowhere else — the rule that
 * uses these lives in `src/shared/gamefiles.ts`.
 */

/** Files that are never the thing you hand an emulator. */
export const SIDECAR_EXTENSIONS: readonly string[] = [
  '.txt',
  '.nfo',
  '.xml',
  '.dat',
  '.md5',
  '.sfv',
  '.sbi',
  '.sub',
  '.ccd',
  '.jpg',
  '.jpeg',
  '.png'
]

/**
 * Disc descriptors, in the order they should be preferred.
 *
 * These must win over the tracks they reference. Handing an emulator the `.bin`
 * of a cue+bin pair loads a headerless track and fails, and a multi-disc set is
 * the `.m3u` rather than any single disc in it — which is also why the playlist
 * outranks the descriptor.
 */
export const DESCRIPTOR_EXTENSIONS: readonly string[] = ['.m3u', '.cue', '.gdi']

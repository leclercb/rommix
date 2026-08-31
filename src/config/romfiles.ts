/**
 * What the files inside a game are.
 *
 * Facts about ROM and disc formats rather than about RomMix: which extensions
 * are a disc descriptor, which are documentation that came along in the archive,
 * and — for the systems that ship a game as a container instead of a disc — how
 * an update is told apart from the game it patches. Adding a format is an edit
 * here and nowhere else: the rule that uses these lives in
 * `src/shared/gamefiles.ts`.
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
 * The archives RomM opens rather than treats as the game.
 *
 * RomM reads inside every one of these to work out what it is holding, and the
 * checksums it records for such a ROM describe the files it found in there —
 * not the archive around them. What it serves for that ROM is the archive, so
 * the two never agree. See `checksumOf`.
 *
 * `.tar.gz` and the rest of the double extensions are here in full: a name is
 * matched against the whole ending rather than the last dot, so `.gz` alone
 * would be a different, and wrong, answer.
 */
export const ARCHIVE_EXTENSIONS: readonly string[] = [
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tbz2',
  '.tar.xz',
  '.txz'
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

/** How to tell one system's containers apart. See `CONTAINER_SYSTEMS`. */
export interface ContainerFormat {
  /** The extensions that are the game itself, and the only ones to launch. */
  extensions: readonly string[]
  /**
   * Names that mark a container as something applied *to* the game rather than
   * the game: an update, or downloadable content. Any match disqualifies it.
   */
  addOnPatterns: readonly RegExp[]
}

/** The container formats a Switch game is shipped in. */
export const SWITCH_CONTAINERS: readonly string[] = ['.nsp', '.xci', '.nsz', '.xcz']

/**
 * Systems where the game is one container file and a playlist is not a thing to
 * launch.
 *
 * The descriptor rule above is a rule about discs: a `.cue` or an `.m3u` is how
 * a disc-based game is handed over, so preferring it over the tracks it names is
 * right wherever there are tracks. A Switch game has none. The NSP or XCI *is*
 * the game, and the update and DLC beside it are further containers of the same
 * kind — but RomM holds all of them as one multi-file game, and a multi-file
 * game comes with an `.m3u` listing its files. Ranked as a descriptor that
 * playlist wins, and Eden is handed a text file it has no loader for.
 *
 * So on these systems the descriptors are skipped and the base game is chosen
 * directly. The update does not need naming: Eden reads external content out of
 * the game's own directory, which is where `flatLibrary` has already put it.
 */
export const CONTAINER_SYSTEMS: Readonly<Record<string, ContainerFormat>> = {
  switch: {
    extensions: SWITCH_CONTAINERS,
    addOnPatterns: [
      /**
       * A title id that is not a base game's.
       *
       * Every Switch title id is sixteen hex digits whose last three say what
       * the file is: a base game ends `000`, its update ends `800`, and DLC
       * counts up from `001`. Dumps conventionally carry the id in brackets, so
       * where one is present it is the most reliable answer there is — and where
       * it is absent nothing matches and the file stays a candidate.
       */
      /\b01[0-9a-f]{11}(?!000\b)[0-9a-f]{3}\b/i,
      /** The same thing said in words, for dumps that label rather than number. */
      /[[(](?:upd|update|dlc)[\])]/i,
      /**
       * A version other than zero. `[v0]` is the game as it shipped; every
       * later version is a patch, and is a separate file here rather than a
       * different copy of the game.
       */
      /\[v(?!0\])\d+\]/i
    ]
  }
}

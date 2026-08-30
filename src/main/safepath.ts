import { normalize, resolve, sep } from 'node:path'

/**
 * Keeping a name that came from somewhere else inside the folder it is meant
 * for.
 *
 * RomM supplies the names RomMix writes under — a ROM's `fs_name`, a firmware
 * file's `file_name` — and a zip supplies the paths inside it. None of those is
 * a stranger's input, since the server is the user's own, but none of them is
 * RomMix's either, and `join` will happily walk out of a directory when handed
 * something that asks to.
 */

/**
 * `join`, unless the result would land outside `root`.
 *
 * Returns null rather than a corrected path: a name that does not belong in
 * this folder is a name to refuse, and silently rewriting it would install a
 * file under something other than what it is called.
 *
 * `resolve` after `normalize` is what does the work — the string form is not
 * the question, since `a/../../b` and `../b` reach the same place and only one
 * of them looks like it does.
 */
export function safeJoin(root: string, relative: string): string | null {
  const target = resolve(root, normalize(relative))
  // Strictly inside: a name that resolves to the folder itself — `''`, `.` —
  // is not a file in it, and every caller here is asking for one.
  return target.startsWith(resolve(root) + sep) ? target : null
}

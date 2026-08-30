import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The three directories the desktop tells an application to use.
 *
 * A module to itself, and one that imports nothing of RomMix's, because both
 * ends of the application need it: `root.ts` resolves where RomMix keeps its
 * own files before anything else has loaded, and `host.ts` reads where *other*
 * applications keep theirs. `host.ts` cannot be the home for these — it reaches
 * for the log, the log reaches for the root, and the root would be reaching
 * back.
 *
 * Every one of them falls back when the variable is set but empty. That is not
 * a hypothetical: a stray `export XDG_CONFIG_HOME=` in a shell profile is
 * indistinguishable from an unset variable to everything else on the system,
 * and reading it as a directory name yields a relative path — a RomMix that
 * writes its configuration wherever it happened to be started from.
 */

/** The user's home directory. */
export function realHome(): string {
  return process.env.HOME || homedir()
}

/** Where applications keep their configuration. */
export function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || join(realHome(), '.config')
}

/** Where applications keep the data they generate. */
export function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME || join(realHome(), '.local', 'share')
}

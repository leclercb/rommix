import { closeSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SaveEnvironment } from '@config/emulators'

/**
 * The real machine, behind the read-only view a descriptor is given.
 *
 * Every method swallows its errors and answers with the empty value. A
 * descriptor asking about a directory that does not exist is not an error —
 * it is a game that has not been played yet, an emulator that has never been
 * started, a config file the user never wrote — and every one of those has to
 * come back as "nothing here" rather than aborting the sync.
 *
 * Deliberately synchronous. These are a handful of small reads on a path that
 * is resolved once per pull or push, and making them async would push the
 * asynchrony into every descriptor for no gain in a place where nothing else
 * is happening.
 */

/** How deep `newest` descends. Enough for a profile folder full of titles. */
const NEWEST_MAX_DEPTH = 3

export function fileSystemEnvironment(): SaveEnvironment {
  return {
    exists(path) {
      try {
        statSync(path)
        return true
      } catch {
        return false
      }
    },

    dirs(path) {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
          .map((entry) => entry.name)
      } catch {
        return []
      }
    },

    files(path) {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
      } catch {
        return []
      }
    },

    text(path) {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return null
      }
    },

    /**
     * The first `bytes` of a file as latin1.
     *
     * latin1 rather than utf8 on purpose: this reads binary ROM headers, and
     * utf8 would replace every invalid sequence with U+FFFD and shift the
     * offsets of everything after it. latin1 is a byte-for-byte mapping, so a
     * run of ASCII inside a binary file — which is exactly what a file name in
     * an archive's table is — survives intact.
     */
    head(path, bytes) {
      let handle: number | null = null
      try {
        handle = openSync(path, 'r')
        const buffer = Buffer.allocUnsafe(bytes)
        const read = readSync(handle, buffer, 0, bytes, 0)
        return buffer.subarray(0, read).toString('latin1')
      } catch {
        return null
      } finally {
        if (handle != null) {
          try {
            closeSync(handle)
          } catch {
            // Already gone; nothing to release.
          }
        }
      }
    },

    newest(path) {
      return newestUnder(path, 0)
    }
  }
}

function newestUnder(path: string, depth: number): number {
  if (depth > NEWEST_MAX_DEPTH) return 0
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return 0
  }

  let latest = 0
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      latest = Math.max(latest, newestUnder(child, depth + 1))
      continue
    }
    try {
      latest = Math.max(latest, statSync(child).mtimeMs)
    } catch {
      // Vanished between the listing and the stat.
    }
  }
  return latest
}

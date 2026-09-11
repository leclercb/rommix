import { createWriteStream } from 'node:fs'
import { mkdir, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { crc32, deflateRaw } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { safeJoin } from './safepath.ts'
import yauzl from 'yauzl'
import { log } from './log.ts'
import { t } from './i18n.ts'

/**
 * Reading and writing zip archives.
 *
 * Reading was already needed for ROM downloads. Writing is what lets a save
 * that is a *directory* — a Switch title's save folder, keyed by title id — be
 * carried to RomM as one asset. RomM stores a save as a file, and the files
 * inside such a folder carry no name that ties them to a game, so uploading
 * them individually would leave a pile of `01.dat`s on the server belonging to
 * nothing in particular.
 *
 * The writer is about eighty lines rather than a dependency. A zip is a
 * concatenation of stored entries followed by a directory of where each one
 * went, `deflateRaw` is in Node's standard library, and the alternative is
 * pulling a package into a project that has three runtime dependencies in order
 * to emit a format that has not changed since 1993.
 */

const deflate = promisify(deflateRaw)

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Reject absolute paths and `..` segments from zip entries (zip-slip).
 *
 * Belt and braces, and known to be: yauzl validates entry names as it reads the
 * central directory and refuses drive letters, a leading `/` and any `..`
 * segment — so in practice a hostile archive is rejected before this is
 * reached, and the whole extraction fails rather than one entry being skipped.
 * This stays because it is the only guard that does not depend on yauzl's
 * defaults staying as they are, and because "the reader happens to check" is
 * not where a path traversal defence belongs.
 */
function entryTarget(root: string, entryName: string): string | null {
  // Only an archive's names need this: a backslash is a separator inside a zip
  // written on Windows and an ordinary character in a Linux filename, so the
  // substitution belongs here rather than in the containment rule.
  //
  // Unreachable while yauzl is left on its default `strictFileNames: false`,
  // which makes the same substitution itself before validating — turning what
  // would otherwise be a refusal into an entry that arrives here already
  // separated by `/`. Kept for the same reason as the containment check below.
  const cleaned = entryName.replace(/\\/g, '/').replace(/^\/+/, '')
  return safeJoin(root, cleaned)
}

/** Does this file start with the ZIP local-file-header magic? */
export async function isZip(path: string): Promise<boolean> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return false
  }
  try {
    const buf = Buffer.alloc(4)
    const { bytesRead } = await handle.read(buf, 0, 4, 0)
    return bytesRead === 4 && buf.toString('latin1') === 'PK\x03\x04'
  } finally {
    await handle.close()
  }
}

/**
 * Extract a zip archive into `destDir`, creating directories as needed.
 *
 * Returns the files it wrote, as absolute paths. A caller that has to tell
 * what came out of the archive from what was already in the folder needs that
 * list and cannot rebuild it afterwards — see `SaveSync.restoreArchive`.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  const root = resolve(destDir)
  await mkdir(root, { recursive: true })
  const took = log.since()
  const written: string[] = []

  await new Promise<void>((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) return rejectPromise(err ?? new Error(t('error.cannotOpenArchive')))

      // yauzl's `autoClose` fires when `readEntry` runs off the end of the
      // archive or when yauzl itself raises — neither of which happens when a
      // `mkdir` or a `pipeline` below is what failed. Without this an
      // extraction into a directory that cannot be written leaves the archive
      // open, so the `rm` that follows unlinks the name and not the bytes, and
      // a game retried a few times leaks a descriptor and its disk space each
      // attempt.
      const fail = (cause: unknown): void => {
        zipfile.close()
        rejectPromise(cause)
      }

      zipfile.on('error', fail)
      zipfile.on('end', () => resolvePromise())

      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        const target = entryTarget(root, entry.fileName)
        if (!target) {
          // Refuse the entry and carry on with the rest. Only reachable for a
          // name yauzl's own validation let through — it rejects the ordinary
          // traversal forms first, and that aborts the archive — so anything
          // arriving here is a shape nobody anticipated and worth a line.
          log.warn('zip', 'refused an entry pointing outside the destination', {
            archive: zipPath,
            entry: entry.fileName
          })
          zipfile.readEntry()
          return
        }

        if (entry.fileName.endsWith('/')) {
          mkdir(target, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(fail)
          return
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return fail(streamErr ?? new Error(t('error.badZipEntry')))
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => {
              written.push(target)
              zipfile.readEntry()
            })
            .catch(fail)
        })
      })
    })
  })

  log.debug('zip', 'extracted', {
    archive: zipPath,
    into: root,
    files: written.length,
    ms: took()
  })
  return written
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

interface PendingEntry {
  /** Path inside the archive, always with forward slashes. */
  name: string
  compressed: Buffer
  crc: number
  size: number
  offset: number
}

/**
 * Every file under `dir`, as archive-relative paths.
 *
 * Symlinks are followed as whatever they point at, which is what makes this
 * work at all under EmuDeck: every directory it gathers under `Emulation/saves`
 * is a symlink into the emulator's real tree.
 *
 * Which means a link pointing back at a directory already on the way down is a
 * walk with no end. `seen` holds the real path of every directory descended
 * into, so a loop is one that is stepped over rather than one that fills the
 * stack — the save is archived without the second copy of itself, which is the
 * outcome a person would have wanted anyway.
 */
async function entryNamesUnder(dir: string, prefix = '', seen?: Set<string>): Promise<string[]> {
  const visited = seen ?? new Set<string>()
  const here = await realpath(dir).catch(() => dir)
  if (visited.has(here)) {
    log.warn('zip', 'a link points back into a folder already being archived', { dir })
    return []
  }
  visited.add(here)

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const found: string[] = []
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const child = join(dir, entry.name)
    let isDirectory = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      isDirectory = await stat(child)
        .then((info) => info.isDirectory())
        .catch(() => false)
    }
    if (isDirectory) found.push(...(await entryNamesUnder(child, relative, visited)))
    else found.push(relative)
  }
  return found
}

/**
 * Archive the contents of `dir` into `zipPath`.
 *
 * The directory itself is not a level in the archive: entries are named
 * relative to it, so extracting into a differently-named folder — a different
 * profile id on another device — puts the files where they belong rather than
 * nesting a copy of the original name inside.
 *
 * Returns the number of files written, so a caller can tell an empty save from
 * a missing one.
 */
export async function zipDirectory(dir: string, zipPath: string): Promise<number> {
  const names = await entryNamesUnder(dir)
  if (names.length === 0) return 0

  const entries: PendingEntry[] = []
  const chunks: Buffer[] = []
  let offset = 0

  for (const name of names) {
    let data: Buffer
    try {
      data = await readFile(join(dir, name))
    } catch (cause) {
      // A file that vanished mid-archive is left out rather than aborting the
      // whole upload; a save is many small files and losing one beats losing all.
      // Said out loud, because what is left out here is what the server ends up
      // not holding, and nothing downstream can tell the difference.
      log.warn('zip', 'a file went missing while the archive was being written', {
        archive: zipPath,
        entry: name,
        reason: (cause as Error).message
      })
      continue
    }
    const compressed = Buffer.from(await deflate(data))
    const crc = crc32(data)
    const nameBytes = Buffer.from(name, 'utf8')

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0x0800, 6) // UTF-8 names
    header.writeUInt16LE(8, 8) // deflate
    header.writeUInt16LE(0, 10) // mod time
    header.writeUInt16LE(0, 12) // mod date
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    header.writeUInt16LE(0, 28) // extra field length

    chunks.push(header, nameBytes, compressed)
    entries.push({ name, compressed, crc, size: data.length, offset })
    offset += header.length + nameBytes.length + compressed.length
  }

  if (entries.length === 0) return 0

  const centralStart = offset
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4) // version made by
    record.writeUInt16LE(20, 6) // version needed
    record.writeUInt16LE(0x0800, 8)
    record.writeUInt16LE(8, 10)
    record.writeUInt16LE(0, 12)
    record.writeUInt16LE(0, 14)
    record.writeUInt32LE(entry.crc, 16)
    record.writeUInt32LE(entry.compressed.length, 20)
    record.writeUInt32LE(entry.size, 24)
    record.writeUInt16LE(nameBytes.length, 28)
    record.writeUInt16LE(0, 30) // extra
    record.writeUInt16LE(0, 32) // comment
    record.writeUInt16LE(0, 34) // disk number
    record.writeUInt16LE(0, 36) // internal attributes
    record.writeUInt32LE(0, 38) // external attributes
    record.writeUInt32LE(entry.offset, 42)

    chunks.push(record, nameBytes)
    offset += record.length + nameBytes.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with central directory
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(offset - centralStart, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20) // comment length
  chunks.push(end)

  await mkdir(dirname(zipPath), { recursive: true })
  const archive = Buffer.concat(chunks)
  await writeFile(zipPath, archive)
  log.debug('zip', 'archived', {
    dir,
    archive: zipPath,
    files: entries.length,
    bytes: archive.length
  })
  return entries.length
}

import { createWriteStream } from 'node:fs'
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { deflateRaw } from 'node:zlib'
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
 * central directory and refuses backslashes, drive letters, a leading `/` and
 * any `..` segment — so in practice a hostile archive is rejected before this
 * is reached, and the whole extraction fails rather than one entry being
 * skipped. This stays because it is the only guard that does not depend on
 * yauzl's defaults staying as they are, and because "the reader happens to
 * check" is not where a path traversal defence belongs.
 */
function entryTarget(root: string, entryName: string): string | null {
  // Only an archive's names need this: a backslash is a separator inside a zip
  // written on Windows and an ordinary character in a Linux filename, so the
  // substitution belongs here rather than in the containment rule.
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

/** Extract a zip archive into `destDir`, creating directories as needed. */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const root = resolve(destDir)
  await mkdir(root, { recursive: true })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) return rejectPromise(err ?? new Error(t('error.cannotOpenArchive')))

      zipfile.on('error', rejectPromise)
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
            .catch(rejectPromise)
          return
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream)
            return rejectPromise(streamErr ?? new Error(t('error.badZipEntry')))
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => zipfile.readEntry())
            .catch(rejectPromise)
        })
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * CRC-32, as the zip format defines it.
 *
 * Node has `zlib.crc32`, but only from 20.15 — new enough to be a version
 * constraint the rest of this project does not have, for ten lines of table.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

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
 */
async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
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
    if (isDirectory) found.push(...(await filesUnder(child, relative)))
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
  const names = await filesUnder(dir)
  if (names.length === 0) return 0

  const entries: PendingEntry[] = []
  const chunks: Buffer[] = []
  let offset = 0

  for (const name of names) {
    let data: Buffer
    try {
      data = await readFile(join(dir, name))
    } catch {
      // A file that vanished mid-archive is left out rather than aborting the
      // whole upload; a save is many small files and losing one beats losing all.
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
  await writeFile(zipPath, Buffer.concat(chunks))
  return entries.length
}

/**
 * Disc images for the tests, built byte by byte.
 *
 * Shared because more than one suite needs the same disc: the one reading its
 * id, the one placing PPSSPP's saves by that id, and the one syncing them. Byte offsets
 * are the whole of what is being tested, so the image is written out field by
 * field rather than taken from a real game. No `node:` import, so it stays
 * loadable wherever `src/config/` is.
 */

export const SECTOR = 2048

export function le32(value: number): string {
  return String.fromCharCode(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    value >>> 24
  )
}

function be32(value: number): string {
  return le32(value).split('').toReversed().join('')
}

/** One ISO 9660 directory record, padded to the even length the format wants. */
function record(name: string, lba: number, length: number, isDirectory: boolean): string {
  const body =
    '\0' +
    le32(lba) +
    be32(lba) +
    le32(length) +
    be32(length) +
    '\0'.repeat(7) +
    (isDirectory ? '\x02' : '\0') +
    '\0\0' +
    '\x01\0\0\x01' +
    String.fromCharCode(name.length) +
    name
  const padded = body.length % 2 === 0 ? body + '\0' : body
  return String.fromCharCode(padded.length + 1) + padded
}

/**
 * A disc holding `files` in its root directory, in the order given.
 *
 * The order matters to whoever asks: a file listed after a large one sits far
 * past anything a read of the image's first bytes would reach.
 */
export function iso(files: Record<string, string>): string {
  const rootLba = 18
  let next = rootLba + 1
  const records = [record('\0', rootLba, SECTOR, true), record('\x01', rootLba, SECTOR, true)]
  const placed: { lba: number; contents: string }[] = []
  for (const [name, contents] of Object.entries(files)) {
    records.push(record(`${name};1`, next, contents.length, false))
    placed.push({ lba: next, contents })
    next += Math.max(1, Math.ceil(contents.length / SECTOR))
  }

  const image = Array.from({ length: next }, () => '\0'.repeat(SECTOR))
  image[16] = ('\x01CD001\x01'.padEnd(156, '\0') + record('\0', rootLba, SECTOR, true)).padEnd(
    SECTOR,
    '\0'
  )
  image[17] = '\xffCD001\x01'.padEnd(SECTOR, '\0')
  image[rootLba] = records.join('').padEnd(SECTOR, '\0')
  for (const { lba, contents } of placed) {
    const sectors = Math.max(1, Math.ceil(contents.length / SECTOR))
    const padded = contents.padEnd(sectors * SECTOR, '\0')
    for (let index = 0; index < sectors; index += 1) {
      image[lba + index] = padded.slice(index * SECTOR, (index + 1) * SECTOR)
    }
  }
  return image.join('')
}

/** A PSP disc declaring `discId` — written as the disc writes it, `ULUS-10064`. */
export function umd(discId: string): string {
  return iso({ 'UMD_DATA.BIN': `${discId}|0123456789ABCDEF|0001|G` })
}

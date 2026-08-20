#!/usr/bin/env node
//
// release-it after:bump hook: add this version to the appstream changelog.
//
// The entry is not bookkeeping — it is the changelog software centres show, and
// the release workflow refuses a tag whose version has no entry. So this writes
// commit subjects only as a fallback: commit a hand-written <release> entry for
// the version beforehand and its prose is left alone. The date is not prose, and
// one written days before the release is wrong, so it is always stamped here.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [version, latestTag] = process.argv.slice(2)
const path = 'flatpak/be.bl_it.RomMix.metainfo.xml'

// Local rather than UTC: an evening release east of Greenwich would otherwise be
// dated tomorrow, in a file whose whole purpose is to be read by a person.
const now = new Date()
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0')
].join('-')

const xml = readFileSync(path, 'utf8')
if (!xml.includes('<releases>')) throw new Error(`${path} has no <releases> element`)

// Written out by hand, possibly, so any attribute order has to be recognised.
const quoted = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const written = xml.match(new RegExp(`<release\\b[^>]*version="${quoted}"[^>]*>`))

if (written) {
  const [opening] = written
  const dated = opening.includes('date="')
    ? opening.replace(/date="[^"]*"/, `date="${today}"`)
    : opening.replace(/>$/, ` date="${today}">`)

  writeFileSync(
    path,
    xml.replace(opening, () => dated)
  )
  console.log(`${path}: kept the ${version} entry, dated ${today}`)
  process.exit(0)
}

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Before the first release there is no tag to start from, and release-it
// interpolates that absence into the literal string "null".
const range = latestTag && latestTag !== 'null' ? `${latestTag}..HEAD` : 'HEAD'
const subjects = execFileSync('git', ['log', range, '--no-merges', '--pretty=%s'], {
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean)

const entry = [
  `    <release version="${version}" date="${today}">`,
  '      <description>',
  '        <ul>',
  ...subjects.map((subject) => `          <li>${escape(subject)}</li>`),
  '        </ul>',
  '      </description>',
  '    </release>',
  ''
].join('\n')

// Newest first: the order appstream expects, and the order the release workflow
// and every software centre read.
writeFileSync(path, xml.replace('  <releases>\n', `  <releases>\n${entry}`))
console.log(`${path}: added ${version} with ${subjects.length} bullet(s)`)

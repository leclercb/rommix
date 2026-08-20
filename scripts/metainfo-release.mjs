#!/usr/bin/env node
//
// release-it after:bump hook: add this version to the appstream changelog.
//
// The entry is not bookkeeping — it is the changelog software centres show, and
// the release workflow refuses a tag whose version has no entry. So this writes
// commit subjects only as a fallback: commit a hand-written <release> entry for
// the version beforehand and the hook leaves it alone.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [version, latestTag] = process.argv.slice(2)
const path = 'flatpak/be.bl_it.RomMix.metainfo.xml'

const xml = readFileSync(path, 'utf8')
if (xml.includes(`<release version="${version}"`)) {
  console.log(`${path} already describes ${version}`)
  process.exit(0)
}
if (!xml.includes('<releases>')) throw new Error(`${path} has no <releases> element`)

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
  `    <release version="${version}" date="${new Date().toISOString().slice(0, 10)}">`,
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

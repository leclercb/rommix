#!/usr/bin/env node
//
// release-it after:bump hook: add this version to CHANGELOG.md.
//
// The entry is not bookkeeping — it is the changelog, and the release workflow
// refuses a tag whose version has no section. So this writes commit subjects
// only as a fallback: commit a hand-written section for the version beforehand
// and its prose is left alone. The date is not prose, and one written days
// before the release is wrong, so it is always stamped here.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [version, latestTag] = process.argv.slice(2)
const path = 'CHANGELOG.md'

// Local rather than UTC: an evening release east of Greenwich would otherwise be
// dated tomorrow, in a file whose whole purpose is to be read by a person.
const now = new Date()
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0')
].join('-')

const markdown = readFileSync(path, 'utf8')

/**
 * The heading for a version, however it was written.
 *
 * Anchored to the start of a line so a version named inside a bullet is not
 * mistaken for its section, and tolerant of what follows: a hand-written
 * section may carry a date already, or nothing at all. What it will not
 * tolerate is more version: the heading ends where the version does, so a
 * longer number is a different section, and so is a release candidate's — a
 * finished version is spelled by the very characters its candidates start
 * with, and every one of them ends up in this file above it.
 */
const quoted = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = new RegExp(`^## ${quoted}(?=\\s|$).*$`, 'm')
const written = markdown.match(heading)

if (written) {
  writeFileSync(path, markdown.replace(heading, `## ${version} — ${today}`))
  console.log(`${path}: kept the ${version} section, dated ${today}`)
  process.exit(0)
}

// Before the first release there is no tag to start from, and release-it
// interpolates that absence into the literal string "null".
const range = latestTag && latestTag !== 'null' ? `${latestTag}..HEAD` : 'HEAD'

// Subject and abbreviated hash: the bullet names the change, and the hash sends
// a reader who wants more than the subject straight to the commit it came from.
const commits = execFileSync('git', ['log', range, '--no-merges', '--pretty=%s (%h)'], {
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean)

const entry = `## ${version} — ${today}\n\n${commits.map((c) => `- ${c}`).join('\n')}\n\n`

/**
 * Newest first, above whatever section currently leads.
 *
 * Inserted before the first `## ` heading rather than appended, and placed by
 * that heading rather than by a line count, so the preamble above it can be
 * rewritten without breaking this.
 */
const first = markdown.search(/^## /m)
if (first === -1) throw new Error(`${path} has no version sections to insert above`)

writeFileSync(path, markdown.slice(0, first) + entry + markdown.slice(first))
console.log(`${path}: added ${version} with ${commits.length} bullet(s)`)

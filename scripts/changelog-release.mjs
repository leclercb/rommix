#!/usr/bin/env node
//
// release-it after:bump hook: add this version to CHANGELOG.md.
//
// The entry is not bookkeeping — it is the changelog, and the release workflow
// refuses a tag whose version has no section. So this writes commit subjects
// only as a fallback: commit a hand-written section for the version beforehand
// and its prose is left alone. The date is not prose, and one written days
// before the release is wrong, so it is always stamped here.
//
// A finished version also takes over from its release candidates — see
// `candidates`.
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

/** Every version heading in the file, newest first. */
const sections = [...markdown.matchAll(/^## (\S+).*$/gm)]

/** What a section says, without the blank lines standing around it. */
const body = (index) =>
  markdown
    .slice(
      sections[index].index + sections[index][0].length,
      sections[index + 1]?.index ?? markdown.length
    )
    .trim()

/**
 * The sections of this version's release candidates, newest first.
 *
 * A candidate is spelled by the finished version and then some, so `0.9.0-rc.3`
 * is one of `0.9.0`'s and `0.9.1` is nobody's. Everything a candidate lists
 * ships in the finished version, so the finished section takes their bullets
 * and the candidates go. Left where they are, the file would say every change
 * of the cycle twice, and the release page would be wrong in both directions:
 * nothing under **What's new** for a version that changed a great deal, and a
 * compare link — the section above this one, in `release-notes.mjs` — spanning
 * only the last candidate instead of the last release anyone not asking for
 * candidates was offered.
 */
const candidates = version.includes('-')
  ? []
  : sections.flatMap((section, index) =>
      section[1].startsWith(`${version}-`)
        ? [
            {
              from: section.index,
              to: sections[index + 1]?.index ?? markdown.length,
              bullets: body(index)
            }
          ]
        : []
    )

// Cut from the last to the first, so a removal never moves a section still to
// be removed out from under its offsets.
const rest = candidates.reduceRight(
  (text, { from, to }) => text.slice(0, from) + text.slice(to),
  markdown
)
const folded = candidates.length ? `, folding in ${candidates.length} candidate section(s)` : ''

/**
 * The heading for a version, however it was written.
 *
 * Anchored to the start of a line so a version named inside a bullet is not
 * mistaken for its section, and tolerant of what follows: a hand-written
 * section may carry a date already, or nothing at all. What it will not
 * tolerate is more version: the heading ends where the version does, so a
 * longer number is a different section, and so is a release candidate's — a
 * finished version is spelled by the very characters its candidates start
 * with, and `candidates` is what answers for those.
 */
const quoted = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = new RegExp(`^## ${quoted}(?=\\s|$).*$`, 'm')

if (heading.test(rest)) {
  writeFileSync(path, rest.replace(heading, `## ${version} — ${today}`))
  console.log(`${path}: kept the ${version} section, dated ${today}${folded}`)
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

// The candidates' bullets follow what has been committed since the last of
// them, which leaves the section as a whole newest first.
const bullets = [
  ...commits.map((commit) => `- ${commit}`),
  ...candidates.map((candidate) => candidate.bullets)
]
  .filter(Boolean)
  .join('\n')

const entry = `## ${version} — ${today}\n\n${bullets}\n\n`

/**
 * Newest first, above whatever section currently leads.
 *
 * Inserted before the first `## ` heading rather than appended, and placed by
 * that heading rather than by a line count, so the preamble above it can be
 * rewritten without breaking this.
 */
const first = rest.search(/^## /m)
if (first === -1) throw new Error(`${path} has no version sections to insert above`)

writeFileSync(path, rest.slice(0, first) + entry + rest.slice(first))
const written = bullets.split('\n').filter((line) => line.startsWith('- ')).length
console.log(`${path}: added ${version} with ${written} bullet(s)${folded}`)

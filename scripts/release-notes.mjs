#!/usr/bin/env node
//
// The body of a GitHub release, printed for the release workflow to publish.
//
// The changelog is the release note. `.github/workflows/release.yml` refuses a
// tag whose version has no section in CHANGELOG.md, so the section is always
// there, and it is the one description of the release that somebody wrote on
// purpose — GitHub's own generated notes are the commit subjects, which is what
// the section falls back to anyway. Printing both would put the same list on
// the page twice.
//
// What follows it is what a person standing at the download needs: which file,
// and what to do with it. Why the Steam script exists, and what to do when it
// is not enough, stays in the README — that is read once, and this page is
// written again with every release.
//
// The file names are written out rather than built from the version: they do
// not carry one. See `appImage.artifactName` in electron-builder.yml — RomMix
// replaces its own image in place, and a name that changed with the release
// would break every shortcut pointing at it.
import { readFileSync } from 'node:fs'

const [version] = process.argv.slice(2)
if (!version) {
  console.error('usage: release-notes.mjs <version>')
  process.exit(1)
}

const REPOSITORY = 'https://github.com/leclercb/rommix'
const markdown = readFileSync('CHANGELOG.md', 'utf8')

/**
 * Every version heading in the file, newest first.
 *
 * Read rather than asked of git: the previous release is the section above
 * this one, which is true in a shallow clone and needs no tags fetched.
 */
const headings = [...markdown.matchAll(/^## (\S+).*$/gm)]
const index = headings.findIndex((heading) => heading[1] === version)
if (index < 0) {
  console.error(`release-notes: no '## ${version}' section in CHANGELOG.md`)
  process.exit(1)
}

const from = headings[index].index + headings[index][0].length
const to = headings[index + 1]?.index ?? markdown.length
const entry = markdown.slice(from, to).trim()

// The tag, not the bare version: that is what the compare page is addressed by.
const previous = headings[index + 1]?.[1]

console.log(`### What's new

${entry}

### Run

Choose \`x86_64\` or \`arm64\` depending on your machine's architecture.

\`\`\`bash
chmod +x RomMix-x86_64.AppImage
./RomMix-x86_64.AppImage
\`\`\`

No version in the file name: updates are written over that same file.

### From Steam

Download \`rommix-steam.sh\` too, \`chmod +x\` it, keep it beside the AppImage,
and add **the script** as the non-Steam game — Steam cannot launch the AppImage
directly.
${previous ? `\n**Full changelog**: ${REPOSITORY}/compare/v${previous}...v${version}\n` : ''}`)

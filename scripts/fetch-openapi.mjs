#!/usr/bin/env node
//
// Add a RomM version to the ones `src/shared/types/romm.test.ts` checks against.
//
// Every server publishes its own schema at `/openapi.json`, so the way to
// support a version is to point this at a server running it. The file is
// written under the version the document declares rather than one typed on the
// command line: what is committed is then always the version it says it is,
// which is the one thing the check cannot verify for itself.
//
// Written through Prettier, though it arrives on one line. The formatting is not
// for whoever writes the file — nobody does — but for whoever reads the diff
// between two RomM versions, which is the only reason to open one at all: as
// served, that diff is a single unreadable row. Prettier rather than
// `JSON.stringify` because it is what `npm run format:check` holds every other
// file to, and a fetch that left the repository unformatted would be a trap.
//
// Removing a file from `schema/` is how a version stops being supported. That
// is a decision, and it belongs in a commit rather than in whatever happens to
// be answering today.
import { writeFileSync } from 'node:fs'
import { format, resolveConfig } from 'prettier'

const DEFAULT = 'https://demo.romm.app'
const [base = DEFAULT] = process.argv.slice(2)

if (base === '--help' || base === '-h') {
  console.error('usage: fetch-openapi.mjs [base-url]')
  console.error(`       defaults to ${DEFAULT}, RomM's own public demo`)
  process.exit(1)
}

const url = `${base.replace(/\/+$/, '')}/openapi.json`
const response = await fetch(url)
if (!response.ok) {
  console.error(`${url} answered ${response.status}`)
  process.exit(1)
}

let document
try {
  document = JSON.parse(await response.text())
} catch {
  console.error(`${url} did not answer with JSON — is that a RomM server?`)
  process.exit(1)
}

const version = document?.info?.version
if (!version || !document?.components?.schemas) {
  console.error(`${url} is not an OpenAPI document with schemas in it`)
  process.exit(1)
}

const path = `schema/romm-${version}.json`
// Through the project's own Prettier configuration, and told the filename so
// that it picks the parser the same way `npm run format` does.
const options = await resolveConfig(path)
writeFileSync(path, await format(JSON.stringify(document), { ...options, filepath: path }))
console.log(`${path} — RomM ${version}, ${Object.keys(document.components.schemas).length} schemas`)

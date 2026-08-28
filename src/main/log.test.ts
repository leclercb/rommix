import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Credential redaction, checked against the file that is actually written.
 *
 * The README tells people the log is safe to paste into a bug report. That is a
 * promise about a hundred lines of `scrub`, and until now nothing verified it —
 * a promise of this kind is worth exactly as much as its test, because the
 * failure mode is a user pasting a working access token into a public issue and
 * neither of us noticing.
 *
 * Tested through the real log file rather than by exporting the scrubber: what
 * matters is what lands on disk, and the path from `log.info` to those bytes
 * runs through level filtering, JSON encoding and the message/detail split, any
 * of which could route a secret around the redaction.
 *
 * `ROMMIX_HOME` has to be set before `log.ts` is imported — it resolves the root
 * once, lazily, and caches it — hence the dynamic import below.
 */

const root = mkdtempSync(join(tmpdir(), 'rommix-log-test-'))
after(() => rmSync(root, { recursive: true, force: true }))

process.env.ROMMIX_HOME = root
delete process.env.ROMMIX_LOG

const { log } = await import('./log.ts')
const logFile = join(root, 'logs', 'rommix.log')

/** Everything written so far. */
function written(): string {
  return readFileSync(logFile, 'utf8')
}

/** A token shaped like the ones RomM issues, and a JWT shaped like its pair. */
const CLIENT_TOKEN = 'rmm_9sKq2LmVx7ZbN4tRfWpE3hJyQd8UcAiG'
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'

test('a client token is redacted wherever it appears', () => {
  log.info('test', `signing in with ${CLIENT_TOKEN}`, { note: `bearer ${CLIENT_TOKEN}` })
  const text = written()
  assert.ok(!text.includes(CLIENT_TOKEN), 'the token itself must not reach the file')
  assert.match(text, /rmm_\*\*\*/)
})

test('a JWT is redacted in both the message and the detail', () => {
  log.info('test', `Authorization: Bearer ${JWT}`, { header: JWT })
  const text = written()
  assert.ok(!text.includes(JWT), 'the JWT must not reach the file')
  assert.match(text, /jwt_\*\*\*/)
})

test('a secret named by its key is masked whatever its shape', () => {
  // The value here looks like nothing in particular, which is the point: the
  // key is what marks it, so a token in an unexpected format is still caught.
  log.info('test', 'connecting', {
    password: 'hunter2',
    accessToken: 'opaque-value-with-no-pattern',
    refresh_token: 'another-opaque-value',
    Authorization: 'Basic dXNlcjpwYXNz',
    apiKey: 'k-123',
    cookie: 'session=abc'
  })
  const text = written()
  for (const secret of [
    'hunter2',
    'opaque-value-with-no-pattern',
    'another-opaque-value',
    'dXNlcjpwYXNz',
    'k-123',
    'session=abc'
  ]) {
    assert.ok(!text.includes(secret), `${secret} must not reach the file`)
  }
})

test('a secret nested inside an object is masked too', () => {
  // `server:connect` arrives at the IPC logger as one payload object, so the
  // credential is never at the top level where a shallow scrub would find it.
  log.info('test', 'ipc', { args: [{ baseUrl: 'https://romm.example.org', token: CLIENT_TOKEN }] })
  const text = written()
  assert.ok(!text.includes(CLIENT_TOKEN))
  // The parts that are not secret still have to survive, or the log stops being
  // worth keeping.
  assert.match(text, /romm\.example\.org/)
})

test('a token in a query string is redacted without losing the path', () => {
  log.info('test', `GET /api/roms?access_token=${CLIENT_TOKEN}&limit=60 → 200`)
  const text = written()
  assert.ok(!text.includes(CLIENT_TOKEN))
  assert.match(text, /access_token=\*\*\*/)
  // The rest of the line is the reason the log exists.
  assert.match(text, /limit=60/)
  assert.match(text, /→ 200/)
})

test('an Error carried into the log is scrubbed along with everything else', () => {
  log.error('test', 'request failed', new Error(`refused token ${CLIENT_TOKEN}`), {
    url: `https://romm.example.org/api/token?token=${CLIENT_TOKEN}`
  })
  assert.ok(!written().includes(CLIENT_TOKEN))
})

test('ordinary detail is not mangled by the scrubber', () => {
  // The other half of the contract: a log that redacts everything is as useless
  // as one that redacts nothing.
  log.info('download', 'installed', { romId: 42, name: 'Cave Story', sizeBytes: 1234567 })
  const text = written()
  assert.match(text, /"romId":42/)
  assert.match(text, /"name":"Cave Story"/)
  assert.match(text, /"sizeBytes":1234567/)
})

test('a value that cannot be serialised does not take the line down with it', () => {
  const circular: Record<string, unknown> = { romId: 1 }
  circular.self = circular
  assert.doesNotThrow(() => log.info('test', 'circular', circular))
})

/**
 * Rolling the file over, and how long the old ones last.
 *
 * The log is the one thing a bug report is made of, so it has to survive long
 * enough to be asked for — and it lives on handhelds, where a folder that only
 * ever grows is a card that eventually fills. Both halves are checked against
 * real files: the rollover by writing past the limit, the sweep by dating a
 * file into the past.
 */

/** A file in the logs folder, dated whenever the test needs it to be. */
function oldLog(name: string, daysAgo: number): string {
  const path = join(root, 'logs', name)
  writeFileSync(path, 'an old session\n')
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  utimesSync(path, when, when)
  return path
}

test('a file past the size limit is rolled over, and the live name starts again', () => {
  log.info('test', 'before the rollover')
  // Past the limit in one line, so the next write is the one that rolls it.
  log.info('test', 'x'.repeat(6 * 1024 * 1024))
  log.info('test', 'after the rollover')

  const rolled = readdirSync(join(root, 'logs')).filter((name) => /^rommix-.*\.log$/.test(name))
  assert.equal(rolled.length, 1)
  // The live file is the new one: what a person opens is always the session
  // they are in.
  assert.match(written(), /after the rollover/)
  assert.equal(written().includes('before the rollover'), false)
  assert.match(readFileSync(join(root, 'logs', rolled[0]), 'utf8'), /before the rollover/)
})

test('a file left over from yesterday is rolled over on the first line of today', () => {
  log.info('test', 'yesterday evening')
  // The file as RomMix would find it after a night switched off. Nothing is
  // scheduled — the next line written is what notices.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  utimesSync(logFile, yesterday, yesterday)

  log.info('test', 'this morning')

  const stamp = [
    yesterday.getFullYear(),
    String(yesterday.getMonth() + 1).padStart(2, '0'),
    String(yesterday.getDate()).padStart(2, '0')
  ].join('-')
  const rolled = readdirSync(join(root, 'logs')).filter((name) =>
    name.startsWith(`rommix-${stamp}`)
  )
  assert.equal(rolled.length, 1)
  // Named for the day it holds, not the day it was renamed on.
  assert.match(readFileSync(join(root, 'logs', rolled[0]), 'utf8'), /yesterday evening/)
  assert.match(written(), /this morning/)
  assert.equal(written().includes('yesterday evening'), false)
})

test('a rolled-over file older than the keeping is deleted, a recent one is not', () => {
  const stale = oldLog('rommix-2026-01-01-00-00-00.log', 40)
  const recent = oldLog('rommix-2026-08-01-00-00-00.log', 2)
  // The name the version that kept one generation wrote, which is still on the
  // disk of anyone who used it.
  const legacy = oldLog('rommix.log.1', 40)

  // The sweep runs with the rollover: one line past the limit, and the next
  // line is the one that rolls the file and clears out the old ones.
  log.info('test', 'y'.repeat(6 * 1024 * 1024))
  log.info('test', 'the line that rolls it')

  assert.equal(existsSync(stale), false)
  assert.equal(existsSync(legacy), false)
  assert.equal(existsSync(recent), true)
})

test('a file somebody put there themselves is left alone, however old', () => {
  const kept = oldLog('rommix.log.for-the-bug-report', 90)
  const notes = oldLog('notes.txt', 90)

  log.info('test', 'z'.repeat(6 * 1024 * 1024))
  log.info('test', 'the line that rolls it')

  assert.equal(existsSync(kept), true)
  assert.equal(existsSync(notes), true)
})

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

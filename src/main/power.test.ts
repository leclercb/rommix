import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { t } from './i18n.ts'
import { power, powerActions } from './power.ts'

/**
 * What is asked of logind, and what is offered where it cannot be asked.
 *
 * Every test here replaces `PATH` with a directory of its own, holding nothing
 * but `sh` and whichever `systemctl` the scenario wants. That is the safety
 * rule as much as the arrangement: `power` runs whatever `systemctl` resolves
 * to, so a suite that left a real one reachable would suspend the machine
 * running it. With `PATH` down to one directory the only `systemctl` that can
 * be found is the script the test wrote.
 *
 * `sh` is there because `binaryPath` probes with `command -v` — see `host.ts`.
 */

const scratches: string[] = []
const PATH = process.env.PATH

afterEach(() => {
  process.env.PATH = PATH
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A PATH holding `sh` alone, which is a machine with no `systemctl` on it. */
function bareMachine(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-power-test-'))
  scratches.push(dir)
  symlinkSync('/bin/sh', join(dir, 'sh'))
  process.env.PATH = dir
  return dir
}

/**
 * The same, plus a `systemctl` that writes down what it was asked for and
 * answers with `script`.
 */
function machineWithSystemctl(script: string): string {
  const dir = bareMachine()
  const systemctl = join(dir, 'systemctl')
  writeFileSync(systemctl, `#!/bin/sh\necho "$1" > "${join(dir, 'asked')}"\n${script}\n`)
  chmodSync(systemctl, 0o755)
  return dir
}

test('a machine with no systemctl is offered nothing', async () => {
  bareMachine()

  assert.deepEqual(await powerActions(), [])
})

test('and one that has it is offered all three, in the order they are drawn', async () => {
  // All or none: polkit's answer to each cannot be known without asking, and
  // asking for poweroff means finding out by turning the machine off.
  machineWithSystemctl('exit 0')

  assert.deepEqual(await powerActions(), ['suspend', 'reboot', 'poweroff'])
})

test('each action reaches logind under the verb logind knows it by', async () => {
  const dir = machineWithSystemctl('exit 0')

  for (const [action, verb] of [
    ['suspend', 'suspend'],
    ['reboot', 'reboot'],
    ['poweroff', 'poweroff']
  ] as const) {
    await power(action)

    assert.equal(readFileSync(join(dir, 'asked'), 'utf8').trim(), verb)
  }
})

test('a refusal is the reason logind gave, in a sentence the player can read', async () => {
  // What polkit answers a user who is not on the active local session. It
  // explains itself once it is on screen and is invisible in the log alone.
  const refusal = 'Interactive authentication required.'
  machineWithSystemctl(`echo "${refusal}" >&2\nexit 1`)

  await assert.rejects(power('poweroff'), (error: Error) => {
    assert.equal(error.message, t('error.power', { reason: refusal }))
    return true
  })
})

test('a systemctl that says nothing still fails with something to read', async () => {
  // No stderr at all, which leaves only what the spawn itself reported. A
  // refusal with an empty sentence in it would be a toast saying nothing.
  machineWithSystemctl('exit 1')

  await assert.rejects(power('reboot'), (error: Error) => {
    assert.ok(error.message.length > t('error.power', { reason: '' }).length)
    return true
  })
})

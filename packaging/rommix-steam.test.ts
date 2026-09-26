import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The script a Steam shortcut is aimed at, in front of the AppImage.
 *
 * Tested from here rather than by `npm run test:app` for the same reason as
 * packaging/rommix-launcher.sh: what it decides is decided before there is an
 * application, and every answer is reached with arguments and environment
 * variables and no window at all.
 *
 * What it hands the image is the whole of its job. A shortcut is edited once
 * and then started for years, on a machine whose owner sees a game that does
 * not start rather than a script that dropped an argument.
 */

const SCRIPT = join(import.meta.dirname, 'rommix-steam.sh')

interface Launch {
  /** What the stand-in image was handed, which is the command line RomMix gets. */
  argv: string[]
  /** The ROMMIX_* variables the stand-in image was started with. */
  env: Record<string, string>
}

const scratches: string[] = []
after(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-steam-'))
  scratches.push(dir)
  return dir
}

/**
 * Run the script with a stand-in for the image, and read back what happened.
 *
 * The stand-in writes its arguments and its environment down: both are what the
 * script decided, and the only honest account of either is the process that
 * received it.
 */
function launch(args: string[] = [], env: Record<string, string> = {}): Launch {
  const dir = scratch()
  writeFileSync(join(dir, 'rommix-steam.sh'), readFileSync(SCRIPT))
  chmodSync(join(dir, 'rommix-steam.sh'), 0o755)
  writeFileSync(
    join(dir, 'RomMix-x86_64.AppImage'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${dir}/argv\nenv | grep '^ROMMIX_' > ${dir}/env || :\n`
  )
  chmodSync(join(dir, 'RomMix-x86_64.AppImage'), 0o755)

  spawnSync(join(dir, 'rommix-steam.sh'), args, {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8'
  })

  const read = (name: string): string[] => {
    try {
      return readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  return {
    argv: read('argv'),
    env: Object.fromEntries(
      read('env').map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1)
      ])
    )
  }
}

describe('the flags it takes', () => {
  test('--canary asks the updater for the rolling tag', () => {
    const { env, argv } = launch(['--canary'])
    assert.equal(env.ROMMIX_CANARY, '1')
    assert.deepEqual(argv, [])
  })

  test('and --log= and --home= carry their value across', () => {
    const { env } = launch(['--log=debug', '--home=/games/rommix'])
    assert.equal(env.ROMMIX_LOG, 'debug')
    assert.equal(env.ROMMIX_HOME, '/games/rommix')
  })

  test('and a flag wins over the variable it sets', () => {
    // The flag is typed for the launch it is on; the variable can be inherited
    // from anywhere the shortcut was started from.
    const { env } = launch(['--log=debug'], { ROMMIX_LOG: 'off' })
    assert.equal(env.ROMMIX_LOG, 'debug')
  })

  test('and the variable alone still reaches the image', () => {
    assert.equal(launch([], { ROMMIX_CANARY: '1' }).env.ROMMIX_CANARY, '1')
  })

  test('and --appimage= names an image nowhere near the script', () => {
    const away = scratch()
    const image = join(away, 'elsewhere.AppImage')
    writeFileSync(image, `#!/bin/sh\nprintf started > ${away}/ran\n`)
    chmodSync(image, 0o755)

    const dir = scratch()
    writeFileSync(join(dir, 'rommix-steam.sh'), readFileSync(SCRIPT))
    chmodSync(join(dir, 'rommix-steam.sh'), 0o755)
    const ran = spawnSync(join(dir, 'rommix-steam.sh'), [`--appimage=${image}`], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8'
    })

    assert.equal(ran.status, 0)
    assert.equal(readFileSync(join(away, 'ran'), 'utf8'), 'started')
  })
})

describe('what it hands the image', () => {
  test('everything it does not take itself, in the order it arrived', () => {
    // Chromium's switches reach RomMix this way, and some take a value as a
    // separate argument.
    const { argv } = launch(['--ozone-platform', 'x11', '--canary', '--no-sandbox'])
    assert.deepEqual(argv, ['--ozone-platform', 'x11', '--no-sandbox'])
  })

  test('and nothing at all where it was given nothing', () => {
    assert.deepEqual(launch().argv, [])
  })
})

describe('when it cannot start', () => {
  test('it says so where no image sits beside it', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'rommix-steam.sh'), readFileSync(SCRIPT))
    chmodSync(join(dir, 'rommix-steam.sh'), 0o755)
    const ran = spawnSync(join(dir, 'rommix-steam.sh'), [], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8'
    })
    assert.equal(ran.status, 1)
    assert.match(ran.stderr, /no RomMix AppImage found/)
    assert.match(ran.stderr, /--appimage=/)
  })
})

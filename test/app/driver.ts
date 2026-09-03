import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Driving the built application from outside it.
 *
 * No automation library. RomMix is already an Electron process, and started
 * with `--remote-debugging-port` it serves the DevTools protocol over a
 * WebSocket — which Node has had built in since 22, so this needs nothing
 * installed. Four messages do everything: `Runtime.evaluate` to read the page,
 * `Input.dispatchKeyEvent` and `Input.dispatchMouseEvent` to drive it, and
 * `Page.captureScreenshot` where a failure is worth looking at.
 *
 * What it drives is `out/`, the real build, so the preload bridge and every IPC
 * channel are the ones that ship. That is the whole point of it — a channel
 * renamed on one side only typechecks, lints, passes every unit test and builds
 * perfectly, and is caught here or not at all.
 */

/** How long to wait for the debugger to come up before giving up on the run. */
const READY_TIMEOUT_MS = 30_000

/** How long any one `waitFor` will keep asking. */
const SETTLE_TIMEOUT_MS = 15_000

/** Between polls of the page. Fast enough to feel instant, slow enough to be cheap. */
const POLL_MS = 100

/**
 * Where a failure leaves its screenshot. See `capture`.
 *
 * Under the repository rather than in a temporary folder, because the reader is
 * usually a CI runner that is about to be thrown away: a path in the checkout
 * is one the workflow can upload, and one a developer can open without being
 * told where to look.
 */
const SHOTS = join(process.cwd(), 'test', 'app', 'failures')

/**
 * The Electron to run.
 *
 * `ELECTRON_EXEC_PATH` first, and for the same reason `.envrc` sets it: on
 * NixOS the binary `npm install` downloads cannot be executed at all — there is
 * no loader at the path it is linked against — and the one from the system
 * profile stands in. electron-vite reads that variable and nothing else, so
 * reading anything else here would make this the one part of the project that
 * will not run on the machine it was written on.
 */
function electronBinary(): string {
  const declared = process.env.ELECTRON_EXEC_PATH?.trim()
  if (declared) return declared
  return join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron')
}

interface Session {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>
  close: () => void
}

/** Ask the debugger for the page target's WebSocket, which appears once it is up. */
async function pageSocket(port: number): Promise<string> {
  const until = Date.now() + READY_TIMEOUT_MS
  let last = 'nothing was tried'
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = (await res.json()) as { type: string; webSocketDebuggerUrl?: string }[]
      const page = targets.find((one) => one.type === 'page' && one.webSocketDebuggerUrl)
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
      last = `${targets.length} targets, none of them a page`
    } catch (cause) {
      last = (cause as Error).message
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`the application's debugger never came up (${last})`)
}

/** One DevTools connection, with replies matched back to their requests by id. */
async function connect(url: string): Promise<Session> {
  const socket = new WebSocket(url)
  const pending = new Map<number, (result: Record<string, unknown>) => void>()
  const failed = new Map<number, (cause: Error) => void>()
  let nextId = 1

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)), {
      once: true
    })
  })

  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number
      result?: Record<string, unknown>
      error?: { message: string }
    }
    if (message.id === undefined) return
    if (message.error) failed.get(message.id)?.(new Error(message.error.message))
    else pending.get(message.id)?.(message.result ?? {})
    pending.delete(message.id)
    failed.delete(message.id)
  })

  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, resolve)
        failed.set(id, reject)
        socket.send(JSON.stringify({ id, method, params }))
      }),
    close: () => socket.close()
  }
}

/** A running RomMix, and the handful of things a scenario does to one. */
export interface App {
  /** Evaluate an expression in the page and return what it produced. */
  read: <T>(expression: string) => Promise<T>
  /**
   * Keep asking until the expression is true, or fail saying what it was.
   *
   * `timeoutMs` for the few things that are slow by design rather than slow
   * because something is wrong — a session runs for as long as the emulator
   * does.
   */
  waitFor: (expression: string, what: string, timeoutMs?: number) => Promise<void>
  /** Press a key, the way the focus engine hears one. */
  press: (key: Key) => Promise<void>
  /** Move the highlight onto the element matching a selector, then select it. */
  choose: (selector: string) => Promise<void>
  /** Put the pointer on something, which is not the same as pressing it. */
  hover: (selector: string) => Promise<void>
  /** Point at something and press it, the way a mouse does. */
  click: (selector: string) => Promise<void>
  /** Turn the wheel over something. Positive is towards the end of the page. */
  wheel: (selector: string, by: number) => Promise<void>
  /** Plug a controller in, which is the input RomMix is really built for. */
  plugInPad: (mapping?: PadMapping) => Promise<Pad>
  /** Type into whatever holds the caret. Only a text field ever does. */
  type: (text: string) => Promise<void>
  /** Go to one of the sections in the navigation bar. */
  goTo: (route: string) => Promise<void>
  /** The label of whatever is highlighted, for a failure worth reading. */
  focused: () => Promise<string>
  home: string
  stop: () => Promise<void>
}

/**
 * The keys `useKeyboard` listens for, by what they do rather than what they are.
 *
 * The four beyond the D-pad are the ones a controller reaches with a button and
 * a keyboard reaches with a key nobody would guess: the shoulder buttons step
 * through a tab strip, Y opens search, Start opens the menu. Without them three
 * of the five actions the interface defines cannot be produced by a test at
 * all — see `keyboardLabel`, which names the same pairs for the hint bar.
 */
export type Key =
  'Up' | 'Down' | 'Left' | 'Right' | 'Enter' | 'Escape' | 'TabNext' | 'TabBack' | 'Search' | 'Menu'

/**
 * Whether Chromium recognised the pad, which changes where its buttons are.
 *
 * `''` is not a broken controller — it is the ordinary state of an Xbox pad
 * over Bluetooth, a clone, or anything the vendor table upstream has not seen,
 * and its buttons then arrive in the order the Linux joystick driver reports
 * them. See `UNMAPPED` in `input/gamepad.ts`.
 */
export type PadMapping = 'standard' | ''

/** A controller Chromium can see, held by the test rather than by a hand. */
export interface Pad {
  /** Press a button and let it go, which is one press to the edge detector. */
  tap: (button: number) => Promise<void>
  /** Hold one down. Repeats start on their own from here. */
  hold: (button: number) => Promise<void>
  release: (button: number) => Promise<void>
  /** Push a stick or a hat. Axes are numbered as the pad reports them. */
  axis: (index: number, value: number) => Promise<void>
  /** Take it away, so a later scenario is not driving one it never asked for. */
  unplug: () => Promise<void>
}

/**
 * How long to leave a button down for a tap.
 *
 * The pad is polled on the animation frame rather than delivered, so a press
 * has to still be down when the next poll comes round. A couple of frames is
 * the smallest thing that is reliably seen.
 */
const TAP_MS = 60

/** Shift, as `Input.dispatchKeyEvent` counts modifiers. */
const SHIFT = 8

const KEYS: Record<
  Key,
  { code: string; key: string; windowsVirtualKeyCode: number; modifiers?: number }
> = {
  Up: { code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38 },
  Down: { code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 },
  Left: { code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  Right: { code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Enter: { code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 },
  Escape: { code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 },
  TabNext: { code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 },
  // The same key held with Shift, which is what the handler reads to tell the
  // two directions apart.
  TabBack: { code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9, modifiers: SHIFT },
  Search: { code: 'Slash', key: '/', windowsVirtualKeyCode: 191 },
  Menu: { code: 'KeyM', key: 'm', windowsVirtualKeyCode: 77 }
}

export interface StartOptions {
  /** The fake server to point it at. */
  baseUrl: string
  /** The client token to seed, so no sign-in screen has to be driven. */
  token: string
  /** Settings to write before the first start — an emulator path, say. */
  settings?: Record<string, unknown>
  /**
   * Environment for the application, and so for anything it starts.
   *
   * `Launcher` hands its own environment to the emulator it spawns, so a
   * variable set here reaches the stand-in too — which is how a test says where
   * it should pretend to write a save. `XDG_CONFIG_HOME` is the other use: it
   * decides where an emulator's descriptor says its saves and cores live, and
   * pinning it is what makes those paths knowable from outside.
   */
  env?: Record<string, string>
}

/** How long the stand-in emulator stays up. See `standInEmulator`. */
const STAND_IN_SECONDS = 8

/**
 * A shell script that behaves enough like an emulator to be launched.
 *
 * It has to outlive `Launcher`'s startup grace — a process gone sooner than
 * that is correctly read as a launch that never happened rather than a session
 * somebody played, whatever it returned. So it sleeps for longer than that
 * grace, which is what makes this a session with save files to account for.
 *
 * It writes its own arguments down before sleeping. That file is the only place
 * the command RomMix actually built can be seen from outside, and the command
 * is the thing worth checking: an emulator started with the wrong path, or with
 * a flag it does not take, fails in the emulator's own words long after RomMix
 * has reported success.
 */
export function standInEmulator(): {
  path: string
  argv: () => Promise<string[]>
  /** What the save file held when the emulator started, or null if there was none. */
  found: (savePath: string) => Promise<string | null>
} {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-stand-in-'))
  const path = join(dir, 'stand-in-emulator')
  const record = join(dir, 'argv')
  writeFileSync(
    path,
    [
      '#!/bin/sh',
      `printf '%s\n' "$@" > ${JSON.stringify(record)}`,
      // A save, where the test asked for one. An emulator writing while it runs
      // is the whole of what a save sync has to notice, and the push after the
      // session only looks at files touched since it started — so this has to
      // happen here rather than being staged before the launch.
      'if [ -n "$ROMMIX_STAND_IN_SAVE" ]; then',
      // What was already there when the emulator started, before it writes
      // anything of its own. This is the only race-free way to ask whether the
      // pull happened first: every other signal — the overlay, the file on
      // disk — is one the test reads after the fact, by which time this has
      // overwritten it.
      // Always written, empty where there was nothing: a missing file cannot
      // tell "the pull left nothing" apart from "the emulator never ran", and
      // waiting for one that is never coming turns a clear failure into a
      // timeout.
      '  cp "$ROMMIX_STAND_IN_SAVE" "$ROMMIX_STAND_IN_SAVE.found" 2>/dev/null || : > "$ROMMIX_STAND_IN_SAVE.found"',
      '  mkdir -p "$(dirname "$ROMMIX_STAND_IN_SAVE")"',
      '  printf %s "$ROMMIX_STAND_IN_SAVE_CONTENT" > "$ROMMIX_STAND_IN_SAVE"',
      'fi',
      `sleep ${STAND_IN_SECONDS}`,
      ''
    ].join('\n'),
    { mode: 0o755 }
  )
  return {
    path,
    /**
     * What it was started with, once it has said.
     *
     * Waited for rather than read: the overlay goes up when RomMix has spawned
     * the process, which is a moment before a shell inside it has run its first
     * line. Reading straight away is a race that loses often enough to be
     * noticed and rarely enough to be blamed on something else.
     */
    argv: async () => {
      const until = Date.now() + SETTLE_TIMEOUT_MS
      while (Date.now() < until) {
        if (existsSync(record)) return readFileSync(record, 'utf8').split('\n').filter(Boolean)
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
      return []
    },
    found: async (savePath: string) => {
      const asFound = `${savePath}.found`
      const until = Date.now() + SETTLE_TIMEOUT_MS
      while (Date.now() < until) {
        if (existsSync(asFound)) return readFileSync(asFound, 'utf8')
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
      return null
    }
  }
}

/**
 * Write the state a signed-in RomMix would already have.
 *
 * `RAW1` is the plaintext credential format — see `Store.loadCredentials`. It
 * exists because a machine with no keyring has to work, and it is what lets a
 * test start at the library instead of driving a pairing flow whose codes it
 * would have to approve on a web UI that is not there.
 */
function seed(home: string, options: StartOptions): void {
  const config = join(home, 'config')
  mkdirSync(config, { recursive: true })
  writeFileSync(
    join(config, 'credentials.bin'),
    Buffer.concat([
      Buffer.from('RAW1'),
      Buffer.from(
        JSON.stringify({
          clientToken: options.token,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          deviceId: 'integration-test'
        })
      )
    ])
  )
  writeFileSync(
    join(config, 'settings.json'),
    JSON.stringify({
      server: { baseUrl: options.baseUrl, authMode: 'token' },
      settings: {
        setupComplete: true,
        // Nothing here should reach for a network that is not the fake one.
        updates: 'off',
        navigationSounds: false,
        ...options.settings
      }
    })
  )
}

/** Start the built application against a fake server, and wait for its window. */
export async function startApp(options: StartOptions): Promise<App> {
  const home = mkdtempSync(join(tmpdir(), 'rommix-app-test-'))
  seed(home, options)

  // Whatever is in there belongs to the run before this one, and a screenshot
  // of a failure that has since been fixed is worse than no screenshot at all —
  // it is read as evidence about the failure being looked at.
  rmSync(SHOTS, { recursive: true, force: true })

  // Port 0 asks the operating system to choose, which is what lets several of
  // these run at once; the debugger prints the one it took on stderr.
  const child: ChildProcess = spawn(electronBinary(), ['.', '--remote-debugging-port=0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ROMMIX_HOME: home,
      // The run must not touch the developer's own RomMix, and must not ask a
      // keyring to encrypt anything it will then be unable to read.
      ROMMIX_LOG: 'debug',
      ...options.env
    }
  })

  let output = ''
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the application never printed a debugger port:\n${output}`)),
      READY_TIMEOUT_MS
    )
    const watch = (chunk: Buffer): void => {
      output += chunk.toString()
      const found = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(output)
      if (found) {
        clearTimeout(timer)
        resolve(Number(found[1]))
      }
    }
    child.stdout?.on('data', watch)
    child.stderr?.on('data', watch)
    // Never started at all, as against started and gone wrong. Worth its own
    // answer because the message is the fix: a checkout that has not run
    // `npx install-electron` has no binary at that path, and without this the
    // spawn failure surfaces thirty seconds later as a debugger that never came
    // up — with nothing in the output to say why, because nothing ever ran.
    child.on('error', (cause) => {
      clearTimeout(timer)
      reject(
        new Error(
          `${electronBinary()} could not be started (${cause.message}). ` +
            'Run `npx install-electron`, or point ELECTRON_EXEC_PATH at an Electron ' +
            'this machine can execute.'
        )
      )
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`the application exited with ${code} before it was ready:\n${output}`))
    })
  })

  const session = await connect(await pageSocket(port))

  const read = async <T>(expression: string): Promise<T> => {
    const result = (await session.send('Runtime.evaluate', {
      // Wrapped in an async function so an expression may `await` — most of
      // what is worth asking the page goes through `window.rommix`, and every
      // one of those answers is a promise. `Runtime.evaluate` takes an
      // expression, not a module, so a bare top-level await is a syntax error.
      expression: `(async () => (${expression}))()`,
      returnByValue: true,
      awaitPromise: true
    })) as { result?: { value?: T }; exceptionDetails?: { text: string } }
    if (result.exceptionDetails) {
      throw new Error(`${result.exceptionDetails.text} while evaluating: ${expression}`)
    }
    return result.result?.value as T
  }

  let shots = 0

  /**
   * Write what was on screen when the driver gave up, and name the file.
   *
   * A message can say what was waited for; it cannot say what was there
   * instead. On a runner nobody watched that is the whole distance between a
   * diagnosis and a re-run — a library that never filled and a library filled
   * behind an overlay give up with the same sentence, and `focused` answers for
   * one element when the question is about the screen.
   *
   * Best effort, and never an error in itself. The debugger having gone is why
   * the test is failing, and something thrown from here would replace the
   * failure worth reading with one about taking its picture.
   */
  const capture = async (what: string): Promise<string> => {
    shots += 1
    const name = `${String(shots).padStart(2, '0')}-${what.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`
    try {
      const shot = (await session.send('Page.captureScreenshot')) as { data?: string }
      if (!shot.data) return ''
      mkdirSync(SHOTS, { recursive: true })
      writeFileSync(join(SHOTS, name), Buffer.from(shot.data, 'base64'))
      return `\nthe screen at that moment: ${join(SHOTS, name)}`
    } catch {
      return ''
    }
  }

  const waitFor = async (
    expression: string,
    what: string,
    timeoutMs = SETTLE_TIMEOUT_MS
  ): Promise<void> => {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      if (await read<boolean>(`Boolean(${expression})`)) return
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
    throw new Error(`gave up waiting for ${what}${await capture(what)}`)
  }

  /**
   * A key press the page's own handler will see.
   *
   * `rawKeyDown`, not `keyDown`: the latter carries a character and is
   * delivered as text, which never reaches the keydown listener the focus
   * engine registers. That distinction cost an afternoon the first time.
   */
  const press = async (key: Key): Promise<void> => {
    const spec = KEYS[key]
    await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...spec })
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec })
    // One frame, so the render the press caused has happened before the next
    // question is asked of the page.
    await read('new Promise((settle) => requestAnimationFrame(() => settle(true)))')
  }

  /**
   * Where to aim the pointer at something, in viewport coordinates.
   *
   * Read from the page rather than worked out here, because only the page knows
   * where anything is: the layout depends on the window, and the window depends
   * on the machine the suite is running on.
   */
  const centreOf = async (
    selector: string
  ): Promise<{ x: number; y: number; edgeX: number; edgeY: number }> => {
    await waitFor(
      `document.querySelector(${JSON.stringify(selector)})`,
      `${selector} to be in the page`
    )
    const at = await read<{ x: number; y: number; edgeX: number; edgeY: number } | null>(
      `(() => {
         const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect()
         return box
           ? {
               x: box.left + box.width / 2,
               y: box.top + box.height / 2,
               // Just outside it, for the approach below.
               edgeX: Math.max(0, box.left - 2),
               edgeY: Math.max(0, box.top - 2)
             }
           : null
       })()`
    )
    if (!at)
      throw new Error(`${selector} is not in the page${await capture(`pointing at ${selector}`)}`)
    return at
  }

  /**
   * The pointer, which RomMix supports and is not designed around.
   *
   * A television is driven with a pad, and everything above presses keys for
   * that reason. But `useFocusable` binds `onMouseEnter` and `onClick` too — for
   * the desk this is also run from — and those are a second way into every
   * button in the application, taken by nothing else here.
   *
   * `mouseMoved` before pressing on purpose: hovering is what moves the
   * highlight, and a press that arrived without one would be a click on
   * something the interface does not consider current.
   */
  const mouse = async (selector: string, type: string, extra: Record<string, unknown> = {}) => {
    const { x, y } = await centreOf(selector)
    await session.send('Input.dispatchMouseEvent', { type, x, y, ...extra })
    await read('new Promise((settle) => requestAnimationFrame(() => settle(true)))')
  }

  /**
   * Bring the pointer onto something, arriving from outside it.
   *
   * A move straight to where the pointer already is is not an arrival: the page
   * hears `mouseenter` when the pointer crosses an edge, so hovering what is
   * already under it does nothing at all. Which is right for a mouse and wrong
   * for a test, where this is the one way to put the highlight somewhere
   * without also pressing it — so the approach is walked rather than assumed.
   */
  const hover = async (selector: string): Promise<void> => {
    const { edgeX, edgeY } = await centreOf(selector)
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: edgeX, y: edgeY })
    await mouse(selector, 'mouseMoved')
  }

  const click = async (selector: string): Promise<void> => {
    await hover(selector)
    const button = { button: 'left', buttons: 1, clickCount: 1 }
    await mouse(selector, 'mousePressed', button)
    await mouse(selector, 'mouseReleased', { ...button, buttons: 0 })
  }

  const wheel = (selector: string, by: number): Promise<void> =>
    mouse(selector, 'mouseWheel', { deltaX: 0, deltaY: by })

  /**
   * A controller, made of nothing but an object the page will believe.
   *
   * `navigator.getGamepads()` is polled every frame and returns plain data, so
   * a pad is exactly that data — no protocol domain, no device, and nothing
   * Chromium has to be persuaded to enumerate. Everything downstream reads it
   * the way it reads a real one.
   *
   * Worth driving at all because the pad reaches parts of the interface the
   * keyboard cannot describe: a held direction that repeats, and the button
   * layout of a controller Chromium could not identify.
   */
  const plugInPad = async (mapping: PadMapping = 'standard'): Promise<Pad> => {
    await read(`(() => {
      window.__rommixPad = {
        id: 'RomMix test pad (Vendor: 0000 Product: 0000)',
        index: 0,
        mapping: ${JSON.stringify(mapping)},
        connected: true,
        timestamp: performance.now(),
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        axes: [0, 0, 0, 0, 0, 0, 0, 0]
      }
      navigator.getGamepads = () => [window.__rommixPad]
      return true
    })()`)

    // A frame, so the poll has seen the pad before anything is pressed on it.
    const settle = (): Promise<boolean> =>
      read('new Promise((done) => requestAnimationFrame(() => done(true)))')

    const button = async (index: number, pressed: boolean): Promise<void> => {
      await read(`(() => {
        const pad = window.__rommixPad
        pad.buttons[${index}] = { pressed: ${pressed}, touched: ${pressed}, value: ${pressed ? 1 : 0} }
        pad.timestamp = performance.now()
        return true
      })()`)
      await settle()
    }

    await settle()
    return {
      hold: (index) => button(index, true),
      release: (index) => button(index, false),
      tap: async (index) => {
        await button(index, true)
        await new Promise((done) => setTimeout(done, TAP_MS))
        await button(index, false)
      },
      axis: async (index, value) => {
        await read(`(() => {
          window.__rommixPad.axes[${index}] = ${value}
          window.__rommixPad.timestamp = performance.now()
          return true
        })()`)
        await settle()
      },
      unplug: async () => {
        await read(`(() => {
          window.__rommixPad = null
          navigator.getGamepads = () => []
          return true
        })()`)
        await settle()
      }
    }
  }

  /**
   * Put text into the field that has the caret.
   *
   * `Input.insertText` rather than a key per letter, which would arrive as
   * `rawKeyDown` and carry no character — the same distinction `press` is built
   * around, from the other side. What the page sees is an ordinary `input`
   * event, which is what a controlled React field listens for.
   *
   * There is exactly one text field in RomMix that a scenario reaches, and
   * reaching it is the caller's business: the caret is what decides where this
   * lands, and typing into a page that has none is a test quietly asserting
   * nothing.
   */
  const type = async (text: string): Promise<void> => {
    const holder = await read<string>(`document.activeElement?.tagName ?? ''`)
    if (holder !== 'INPUT' && holder !== 'TEXTAREA') {
      throw new Error(
        `nothing has the caret, so ${JSON.stringify(text)} would go nowhere` +
          (await capture(`typing ${text}`))
      )
    }
    await session.send('Input.insertText', { text })
    await read('new Promise((settle) => requestAnimationFrame(() => settle(true)))')
  }

  /** What the highlight is on, read the way `useFocusable` marks it. */
  const focused = (): Promise<string> =>
    read<string>(
      `(document.querySelector('[data-focused="true"]')?.textContent ?? '(nothing)').trim()`
    )

  /**
   * What the highlight is on, as something two reads can be compared by.
   *
   * Waited for rather than read once. A list that is still filling — the
   * library, as its first page arrives — re-renders with nothing focused for a
   * frame, and a scan that read that moment would see two identical empty
   * answers and conclude it had hit a wall. Which it does, reliably, only when
   * the machine is busy enough: exactly the conditions of a CI runner.
   */
  const highlight = async (): Promise<string> => {
    const until = Date.now() + SETTLE_TIMEOUT_MS
    while (Date.now() < until) {
      const on = await read<string>(
        `(() => {
           const one = document.querySelector('[data-focused="true"]')
           return one ? one.tagName + '|' + one.className + '|' + one.textContent.slice(0, 40) : ''
         })()`
      )
      if (on) return on
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
    return ''
  }

  /**
   * Walk the highlight onto something and press it.
   *
   * Pressing keys rather than clicking, because the focus engine is one of the
   * things worth knowing still works — a click would go straight to the handler
   * and prove nothing about how anybody actually reaches the button.
   *
   * An exploration that remembers where it has been, rather than a scan in one
   * direction. Neither of the two shapes on screen is a grid a raster would
   * cross: the library's filters wrap — Down off the last of them returns to
   * the first — so a walk that only pressed Down and Right went round the
   * toolbar until it ran out of patience and never once looked at a game.
   * Preferring a square it has not stood on turns that loop into a dead end,
   * which is a thing the walk can back out of.
   */
  const choose = async (selector: string): Promise<void> => {
    // Drawn *and* registered with the focus engine, which is a later moment:
    // every focusable carries `data-focused`, so its absence means the element
    // is in the page and cannot yet be moved onto. Starting before that is how
    // a walk decides a whole grid is not there.
    await waitFor(
      `document.querySelector(${JSON.stringify(selector)})?.matches('[data-focused]') ?? false`,
      `${selector} to be reachable`
    )

    const there = (): Promise<boolean> =>
      read<boolean>(
        `document.querySelector(${JSON.stringify(selector)})?.matches('[data-focused="true"]') ?? false`
      )

    /**
     * Which way the target lies from the highlight, or '' when it is reached.
     *
     * Homing on where the thing actually is, rather than sweeping and hoping.
     * The interface is laid out for a person pointing a D-pad at what they can
     * see, so the direction that closes the larger gap is the direction they
     * would press — and it converges in a handful of presses where a search
     * wanders for a hundred.
     */
    const towards = (): Promise<string> =>
      read<string>(
        `(() => {
           const target = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect()
           const here = document.querySelector('[data-focused="true"]')?.getBoundingClientRect()
           if (!target || !here) return ''
           const across = target.left + target.width / 2 - (here.left + here.width / 2)
           const down = target.top + target.height / 2 - (here.top + here.height / 2)
           if (Math.abs(across) < 4 && Math.abs(down) < 4) return ''
           return Math.abs(down) >= Math.abs(across)
             ? down > 0 ? 'Down' : 'Up'
             : across > 0 ? 'Right' : 'Left'
         })()`
      )

    for (let step = 0; step < 40; step += 1) {
      if (await there()) return press('Enter')
      const key = (await towards()) as Key | ''
      if (!key) break
      const before = await highlight()
      await press(key)
      // A wall in the direction it wanted. The other axis is the way round it —
      // a game two rows down and one column left is not reachable by pressing
      // Down alone once the column has run out.
      if ((await highlight()) === before) {
        const sideways: Key =
          key === 'Up' || key === 'Down'
            ? (await towards()) === 'Left'
              ? 'Left'
              : 'Right'
            : (await towards()) === 'Up'
              ? 'Up'
              : 'Down'
        await press(sideways)
        if ((await highlight()) === before) break
      }
    }

    /**
     * Failing that, a walk that remembers where it has been.
     *
     * Homing assumes the highlight can be moved towards what is on screen, and
     * that is not true across a zone boundary — where the geometry says one
     * thing and the focus engine another. This covers that: it takes whatever a
     * press gives it and prefers somewhere it has not stood, which gets out of
     * a corner homing would press into for ever.
     */
    const seen = new Set<string>()
    const keys: Key[] = ['Right', 'Down', 'Left', 'Up']

    for (let step = 0; step < 60; step += 1) {
      if (await there()) return press('Enter')
      const before = await highlight()
      seen.add(before)

      // The order rotates with the step, which is what stops a corner the walk
      // keeps returning to from being a corner it keeps leaving the same way.
      const order = keys.map((_, at) => keys[(at + step) % keys.length])
      let landed = ''
      for (const key of order) {
        await press(key)
        const after = await highlight()
        if (await there()) return press('Enter')
        if (after === before) continue
        landed = after
        if (!seen.has(after)) break
      }
      if (!landed) break
    }

    throw new Error(
      `the highlight never reached ${selector}; it is on ${await highlight()} ("${await focused()}")` +
        (await capture(`reaching ${selector}`))
    )
  }

  /**
   * Go to a section, the way the interface offers it.
   *
   * The navigation bar is a focus zone rather than the row above the content,
   * and directional movement does not climb into it — Back does, which is what
   * `App`'s own handler means by `enterZone('nav')`. So a test that pressed Up
   * would never arrive, and one that clicked would not be testing the way
   * anybody reaches it with a controller.
   *
   * Back until it is in the bar rather than once: the first press steps back
   * through the screen's own history where it has any, and only the press with
   * nowhere left to go climbs into the menu. Never pressed while already in the
   * bar, which is the press that offers to quit.
   *
   * Then along it by counting rather than by feeling for the end. The bar is a
   * row whose order the page will simply state, and a walk that pressed Right
   * until something looked right would leave the bar the moment it ran off the
   * end of it.
   */
  const goTo = async (route: string): Promise<void> => {
    const item = `.topbar__nav [data-route="${route}"]`
    await waitFor(`document.querySelector(${JSON.stringify(item)})`, `the ${route} menu item`)

    const inBar = (): Promise<boolean> =>
      read<boolean>(
        `Boolean(document.querySelector('[data-focused="true"]')?.closest('.topbar__nav'))`
      )
    const arrived = (): Promise<boolean> =>
      read<boolean>(
        `document.querySelector(${JSON.stringify(item)})?.matches('[data-focused="true"]') ?? false`
      )

    // Three goes at it, because a screen still filling can move the highlight
    // out of the bar between measuring the distance and walking it — which is
    // not a broken menu, just a slow one, and the answer is to look again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (let step = 0; step < 5 && !(await inBar()); step += 1) {
        await press('Escape')
        if (await read<boolean>(`Boolean(document.querySelector('.overlay'))`)) {
          throw new Error('backing out to the menu reached the quit confirmation')
        }
      }
      if (!(await inBar())) continue

      const distance = await read<number>(
        `(() => {
           const items = [...document.querySelectorAll('.topbar__nav [data-route]')]
           const wanted = items.findIndex((one) => one.dataset.route === ${JSON.stringify(route)})
           const here = items.findIndex((one) => one.matches('[data-focused="true"]'))
           return wanted < 0 || here < 0 ? NaN : wanted - here
         })()`
      )
      if (Number.isNaN(distance)) continue

      // One press at a time, checking after each: a fixed count walked blindly
      // carries on past the bar if anything moved the highlight on the way.
      for (let step = 0; step < Math.abs(distance); step += 1) {
        if (await arrived()) break
        if (!(await inBar())) break
        await press(distance > 0 ? 'Right' : 'Left')
      }
      if (await arrived()) return press('Enter')
    }

    throw new Error(
      `the menu never reached ${route}; the highlight is on "${await focused()}"` +
        (await capture(`going to ${route}`))
    )
  }

  return {
    read,
    waitFor,
    press,
    choose,
    hover,
    click,
    wheel,
    plugInPad,
    type,
    goTo,
    focused,
    home,
    stop: async () => {
      session.close()
      child.kill('SIGTERM')
      await new Promise((resolve) => {
        child.once('exit', resolve)
        setTimeout(() => {
          child.kill('SIGKILL')
          resolve(null)
        }, 5000)
      })
      rmSync(home, { recursive: true, force: true })
    }
  }
}

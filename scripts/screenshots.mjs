//
// The pictures on the landing page, taken from the demo rather than drawn.
//
// The page used to carry a hand-built replica of the home screen — several
// hundred lines of markup and CSS imitating a shelf of games. It was a copy that
// could only ever be as current as the last time somebody remembered it existed,
// and the thing it was imitating is already published beside it as the demo. So
// the page shows the real interface, and this takes the pictures of it.
//
// Electron rather than a headless browser, because the repository already has
// one: RomMix is an Electron app, and the demo is its renderer with a stub
// library behind it. Playwright would be a browser download and a dependency to
// keep current for a job that is a window, a click and `capturePage`.
//
// Run with `npm run screenshots`, which builds the demo first — this loads what
// that build produced, so what is photographed is what visitors will use.
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * 1080p, the screen RomMix is drawn for.
 *
 * The stylesheet is written in CSS pixels for a television, so this is the size
 * at which the layout is the one its author sees. The scale is forced below to
 * match, or the same command would produce twice the picture on a HiDPI machine
 * and the images in the repository would flip size with whoever ran it.
 */
const WIDTH = 1920
const HEIGHT = 1080

/** Where the built demo is, and where the pictures go. */
const DEMO = resolve('out/site/demo/index.html')
const IMAGES = resolve('site/img')

/**
 * What to photograph, in the order a visitor would meet it.
 *
 * `reach` is what a mouse would do to get there: the demo has no addresses —
 * every screen is a state of one document — so the way to a screen is the way
 * anybody else gets to it. Written as a click on what is on screen rather than
 * as a call into the application, so a screen that stops being reachable takes
 * this with it instead of quietly photographing the wrong thing.
 */
const SHOTS = [
  { name: 'home', reach: null },
  { name: 'game', reach: '.hero' },
  { name: 'library', reach: '.nav-item:nth-of-type(2)' },
  { name: 'downloads', reach: '.nav-item:nth-of-type(4)' },
  { name: 'bios', reach: '.nav-item:nth-of-type(5)' },
  { name: 'emulators', reach: '.nav-item:nth-of-type(6)' },
  { name: 'settings', reach: '.nav-item:nth-of-type(7)' }
]

/** Give the interface a moment, then make sure it has actually finished. */
const SETTLED = `new Promise((resolve) => {
  const ready = () =>
    document.querySelector('.spinner') === null &&
    [...document.images].every((image) => image.complete)
  const started = Date.now()
  const poll = setInterval(() => {
    // A cap, so a picture is taken of whatever is there rather than the script
    // waiting for ever on a screen that never settles.
    if (ready() || Date.now() - started > 8000) {
      clearInterval(poll)
      // A pause rather than an animation frame: the window is never shown, and
      // one that is not on a screen stops being animated, so waiting for a
      // frame here waits for one that will not come.
      setTimeout(() => resolve(true), 300)
    }
  }, 50)
})`

/** Click something the way a visitor would, and fail loudly if it is not there. */
const clickOn = (selector) => `(() => {
  const target = document.querySelector(${JSON.stringify(selector)})
  if (!target) throw new Error('nothing matches ${selector}')
  target.click()
  return true
})()`

// Before ready, which is the only time they are read.
app.commandLine.appendSwitch('force-device-scale-factor', '1')

/**
 * Everything after Electron is up, in a function rather than at the top level.
 *
 * An ESM main process that awaits before `app.whenReady()` has resolved never
 * gets there — the module's top-level await and Electron's own start-up wait on
 * each other, and the process sits still with nothing on stdout to say why.
 */
async function shoot() {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    // The page, not the window: with the frame counted in, every picture would
    // be short by the height of a title bar that is not in it.
    useContentSize: true,
    show: false,
    /**
     * Drawn off screen rather than into a window nobody sees.
     *
     * A hidden window is painted once and then left alone, so the first picture
     * comes out and every one after it waits for a frame that is never drawn.
     * Off-screen rendering keeps producing frames with nothing to show them on,
     * which is exactly what is wanted here — and it means the command needs no
     * desktop to run on.
     */
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  window.webContents.setZoomFactor(1)

  await window.loadFile(DEMO)
  mkdirSync(IMAGES, { recursive: true })

  for (const shot of SHOTS) {
    if (shot.reach) await window.webContents.executeJavaScript(clickOn(shot.reach))
    await window.webContents.executeJavaScript(SETTLED)

    const image = await window.webContents.capturePage()
    const path = join(IMAGES, `${shot.name}.png`)
    writeFileSync(path, image.toPNG())
    console.log(`${path}  ${image.getSize().width}x${image.getSize().height}`)

    // Back to where every route is reachable from, so each shot starts from the
    // same place rather than from wherever the last one left the interface.
    if (shot.reach) await window.webContents.executeJavaScript(clickOn('.nav-item:nth-of-type(1)'))
  }
}

app.whenReady().then(async () => {
  try {
    await shoot()
    app.exit(0)
  } catch (cause) {
    console.error(`screenshots: ${cause instanceof Error ? cause.message : String(cause)}`)
    app.exit(1)
  }
})

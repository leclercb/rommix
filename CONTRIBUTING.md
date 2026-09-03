# Contributing to RomMix

Thanks for looking. RomMix is a front end for [RomM](https://romm.app) that runs
on a television and is driven with a controller, and most of what makes it hard
is other people's software: five emulators, three packaging formats and a
different folder layout behind each one.

## Getting set up

Node 24 or newer — the version RomMix is built, tested and released on.

Higher than either the AppImage or `npm test` strictly needs: the suite wants
Node's own type stripping and a `module.registerHooks` loader, both of which
arrived in 22.15. Nothing an end user installs depends on any of it — the
AppImage carries Electron's own runtime — so this is a number for contributors.

```bash
git clone https://github.com/leclercb/rommix.git
cd rommix
npm install
npx install-electron   # Electron no longer fetches its binary on install
npm run dev
```

`npm run dev` wants a real RomM server. If you do not have one to hand,
`npm run preview:app` runs the interface in a browser against a stub library —
see [The web preview](README.md#the-web-preview-and-the-site).

## Before you open a pull request

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
```

CI runs exactly these four, in this order, on every pull request. `npm run
format` fixes the first one for you.

`npm install` also installs a pre-commit hook that runs them — plus `npm run
build`, which is the one thing CI does that the tests do not, a renderer being
perfectly capable of typechecking and then failing to bundle. It takes about six
seconds. `git commit --no-verify` skips it, which is the right answer for a
work-in-progress commit on a branch and the wrong one for anything you are about
to push.

`npm run test:app` is the other suite: the built application, driven from
outside against a fake RomM, covering what the unit tests deliberately leave
out — the renderer, the IPC wiring and the preload bridge together. It needs a
window, and one the size RomMix is drawn for — on a headless machine that is

```bash
xvfb-run --server-args="-screen 0 1920x1080x24" npm run test:app
```

The screen size is not incidental. The stylesheet is written for a 1080p
television, and on Xvfb's default screen the library's games land below the fold
of a window too small to hold them — where they are drawn, and unreachable,
which reads as a focus engine that has stopped working. See
[test/app/](test/app/).

It runs one file at a time on purpose. There is a real window being driven, and
a second suite competing for the machine changes how long a list takes to draw —
which showed up as the focus scan giving up on a library that was still filling.
A GUI under test is not a thing to parallelise.

Two scenario files, split by whether order matters. `games.test.ts` is one
session read top to bottom — the game downloaded by one scenario is the game
launched by the next, and the last takes the server away — because none of those
states can be seeded from outside without seeding away the thing under test.
`interface.test.ts` needs nothing on disk and each of its scenarios opens the
section it is about, so it can be read, and run, in any order. Both start from
`startScenario` in `harness.ts`, which is what stops the settings the two share
from drifting apart.

Where it gives up it leaves a screenshot behind, named after what it was waiting
for and pointed at from the failure message — see `capture` in
[test/app/driver.ts](test/app/driver.ts). A failure here is otherwise a sentence
about what did not happen with nothing to say what was on the screen instead,
which on a runner nobody watched is the difference between a diagnosis and
another run.

Not in the pre-commit hook, which is budgeted in seconds — but `npm run release`
runs it, because a tag is public the moment it is pushed. Releasing from a
headless machine means running that under `xvfb-run` too.

Keys, the pointer and a controller, because the interface takes all three:
`useFocusable` binds `onMouseEnter` and `onClick` beside the focus engine, and a
change that breaks one and not the other would otherwise go out. The pad is what
RomMix is designed around, so a scenario reaches a button by walking to it
unless another input is the subject.

The controller is an object rather than a device — `navigator.getGamepads()` is
polled and returns plain data, so `plugInPad` supplies some. That is what
reaches the two things no key can describe: a held direction that repeats, and
the button layout of a pad Chromium could not identify.

Not covered there: what the pad does while an emulator owns the screen, where
every press but Start held down is dropped. It needs a game running to mean
anything, and sequencing it inside a launch made the scenario about timing
rather than about input.

`npm run test:coverage` runs the same suite with Node's coverage report and a
floor under it. The floor is there to stop the number sliding, not to be aimed
at: a module worth adding is worth testing, and the report says which lines of
it nothing has run. Only files a test actually imports appear — the renderer,
the IPC wiring and anything that drives Electron or spawns a process are
deliberately absent, and are covered by running the application.

## Where things live

`src/config/` is the part most changes belong in.

| You want to             | Edit                                               |
| ----------------------- | -------------------------------------------------- |
| Add a system            | the table in `src/config/systems.ts`               |
| Map a RomM platform     | the `slugs` column of that same row                |
| Say what a BIOS needs   | `src/config/bios.ts`                               |
| Teach a new ROM format  | `src/config/romfiles.ts`                           |
| Add an emulator         | a folder under `src/config/emulators/` — see below |
| Change what RomMix says | `src/shared/i18n/en.ts`, then the other three      |
| Change the landing page | `site/text/en.json`, then the other three          |

**No code outside `src/config/` names an emulator.** That is a rule, not a
tendency: `src/main/emulators.ts` probes whatever the registry declares, and the
two prose lists that do name them — the table in the README and the one in
`site/text/*.json` — have to be edited by hand.

### Wording

Nothing user-facing is written where it is drawn. Every phrase lives in
`src/shared/i18n/`, English first — `fr.ts`, `de.ts` and `es.ts` are declared as
`Catalog`, so adding a key to English and forgetting one of them does not
compile. `npm test` checks the parts the types cannot: that each language
substitutes the same `{placeholders}`, and that a plural set has all its forms.

Two of these are checked by `npm test` rather than by review: no error in
`src/main` may be thrown with a written-out message, and no text may sit loose
in the renderer's markup. Log lines are exempt on purpose — the log is what gets
attached to a bug report, and one in four languages is one nobody can triage.

Counts go through `t('key', { count })` with `_one` / `_other` entries, never
`count === 1 ? … : …` — French keeps the singular at zero and German does not.
Anything a phrase wraps that is not text (a `<strong>`, the heart in the footer)
stays one catalogue entry with a placeholder, and `Filled` splits it: word order
is the first thing a language changes.

Text that belongs to one emulator — its setup steps, why its saves cannot be
synced — is in the catalogue like everything else. The rule that keeps emulator
_logic_ inside `src/config/emulators/<id>/` does not extend to wording: a
descriptor is a pure function of an install and has nowhere to get a language
from, so it names a phrase (`unsyncableReason: 'saves.dolphin'`) and `localize`
resolves it at the boundary. One entry then serves every frontend shipping the
same component — RetroDECK and EmuDeck both run Dolphin.

### Adding an emulator

Start from [`src/config/emulators/example/index.ts`](src/config/emulators/example/index.ts).
It is a complete, annotated `EmulatorDescriptor` that documents every field and
every value it can take, and the compiler checks it alongside the five real
ones — so adding a field to the interface breaks the example too, which is the
point of it.

1. Copy it to `src/config/emulators/<your emulator>/index.ts`.
2. Delete the branches that do not apply.
3. Add it to `EMULATORS` in `src/config/emulators/index.ts`. Order there is
   preference order.
4. Add cases to `src/config/emulators/registry.test.ts` and, if it has a save
   layout worth describing, `savepaths.test.ts`.

Nothing in `src/config/` may import `node:` anything — the registry is loaded by
the renderer as well as the main process. Anything that has to look at the
machine asks through the `SaveEnvironment` handed to `saves()`.

### The main process

`src/main/` drives the machine: downloads, launching, save sync, BIOS placement.
Relative imports there carry an explicit `.ts`, the same as `src/config/` and
`src/shared/` — the bundler does not care, but the test runner cannot resolve
them otherwise, and every helper in there is meant to stay testable.

`scripts/test-resolve.mjs` supplies the two things Node lacks: the
`@shared`/`@config` aliases, and a stub for `electron` that throws by name if a
test actually calls it.

`src/main/ipc/` is one module per subject — `saves.ts`, `game.ts`, `system.ts`
and the rest — each exporting a `register…Ipc(rommix, handle)` that declares its
own channels. A new channel goes in the module it belongs to; `index.ts` only
composes them, and `handler.ts` is the wrapper that logs every call and turns a
thrown error into a message the renderer can show.

`src/main/romm/` is everything that talks to the server, split by what each part
answers for rather than by endpoint: `client.ts` says what to ask for,
`transfer.ts` owns what happens to bytes on their way to the disk, `checksums.ts`
decides which hash describes what is arriving, and `errors.ts` holds the three
failures the rest of RomMix branches on. A new endpoint is a method on the
client; everything else there is imported through `index.ts`.

### Talking to RomM's API

`src/shared/types/romm.ts` is a transcription of RomM's schema made by hand, and
`schema/` holds the `/openapi.json` of every RomM version RomMix supports.
`npm test` checks the first against all of the second: a field renamed upstream
is otherwise `undefined` with nothing between it and a screen.

Each type is bound to its schema by the name in its own doc comment — `GET
/api/users/me (\`UserSchema\`)`— so there is no table to keep beside it.`?` on
a field means one supported version does not send it, and nothing else.

Bodies RomMix **sends** are declared there too, and say `body` in their comment,
because the two directions are checked by opposite rules. A response may carry
more than a type admits and that is caution; a request that omits a field RomM
requires is a 422 nobody sees until it meets a real server — and the fake in
`test/app/` cannot find it, having been written from the same reading of the
schema. `satisfies` at the call site is what binds the body actually sent to the
type being checked.

Add a version with `npm run schema:fetch https://your.romm`, which names the
file after whatever the server says it is. Dropping one is how a version stops
being supported: a decision worth a commit rather than drift.

### Shared between the two

`src/shared/types/` is the language the main process, the preload bridge and the
renderer share, one file per subject and one barrel over them. `romm.ts` is the
odd one out and is kept apart for it: it mirrors RomM's own schema and spells
every field the way the server does — `fs_name`, `md5_hash`, `is_favorite` — so
that a field can be looked up in RomM's `/openapi.json` without a translation
step in between. Everything beside it is RomMix's own state and is written the
way the rest of the codebase is.

### The renderer

`src/renderer/src/components/` is the shared UI, imported as one module
(`../components`); `input/` is the focus engine, split into the geometry, the
scrolling and the two input sources it is built from.

Seven attributes exist for `npm run test:app` and nothing else: `data-screen` on
the shell, `data-route` on a menu item, `data-rom` on a game card,
`data-emulator` on a row of the emulator list, `data-collection` on a shelf,
`data-tab` on a tab, and `data-action` on a `FocusButton` that a scenario
presses. They are there because
every other handle on the interface changes — the text with the language, the
position with the next button added beside it. Add one when a test needs it, not
before.

Every screen is a folder under `screens/`, named after the screen and holding
`index.tsx` — the screen itself — with its own parts beside it: `Game/` keeps
its banner, its dialogs and its save hook, and its four tabs in `tabs/`. A
screen that is still one file gets the folder anyway, so growing one is a new
file rather than a move. The folder is named for the screen's subject, which is
also the route it answers to (`Game/`, `{ name: 'game', romId }`).

Styles follow the same shape: `styles/index.css` imports one file per area of
the interface, and the import order there is the cascade.

### The linter

[oxlint](https://oxc.rs), not ESLint. That started as a constraint — no published
`typescript-eslint` supports TypeScript 7, which this project is on — and has
since become a preference: it lints the whole tree in well under a second, needs
no parser plugin, and carries the two rules worth having here,
`react/exhaustive-deps` and `react/rules-of-hooks`.

**TODO:** revisit when typescript-eslint's `typescript` peer range moves past
`<6.1.0`. Revisiting is not the same as switching — the case for adding ESLint
back would be a specific type-aware rule oxlint cannot express, such as
`no-floating-promises`, and the answer then might well be both: oxlint on every
commit, a type-aware pass in CI. Every rule switched off in
[.oxlintrc.json](.oxlintrc.json) says why it is off, so that file is the place to
argue with any of this.

## House style

Prettier settles formatting; there is nothing to argue about there. The one
convention worth stating is the comments: they explain **why**, not what, and
they are specific enough to be checked. If a comment says RetroDECK writes a
file in a particular place, someone should be able to go and look. Vague
comments are worse than none, because they cannot be found to be wrong.

Keep user-facing copy short and concrete. A control says what happens, an error
says what went wrong and what to do about it.

## Reporting a bug

Settings → **Pre-flight check** names the log file. Everything RomMix does is in
it — the exact command each emulator was started with, what was asked of RomM
and what came back, where every file was written — and credentials are stripped
on the way in, so it is safe to paste as it is. `ROMMIX_LOG=debug` turns on the
detail.

Please include the log, your distribution, and which emulator was involved.

## Licence

By contributing you agree that your work is licensed under the
[MIT licence](LICENSE) that covers the rest of the project.

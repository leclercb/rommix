# Contributing to RomMix

Thanks for looking. RomMix is a front end for [RomM](https://romm.app) that runs
on a television and is driven with a controller, and most of what makes it hard
is other people's software: every emulator it drives is packaged more than one
way, with a different folder layout behind every combination.

## Getting set up

Node 24 or newer, as `engines` in `package.json` says. Higher than either the
AppImage or `npm test` strictly needs — the suite wants Node's own type
stripping and a `module.registerHooks` loader — and nothing an end user installs
depends on it, the AppImage carrying Electron's own runtime.

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
perfectly capable of typechecking and then failing to bundle. `git commit
--no-verify` skips it, which is the right answer for a work-in-progress commit
on a branch and the wrong one for anything you are about to push.

`npm run test:app` is the other suite: the built application, driven from
outside against a fake RomM, covering what the unit tests deliberately leave
out — the renderer, the IPC wiring and the preload bridge together.

```bash
npm run test:app
```

That is the whole of it, on a desktop and on a runner with no screen at all.
An Electron this machine can execute and a screen to draw on are what
[scripts/headless.sh](scripts/headless.sh) supplies where they are missing,
borrowed from nixpkgs for the length of the run; what it can neither find nor
borrow it names, and stops. That is also why `npm run release` runs the suite
before it tags anything — a tag is public the moment it is pushed. Not in the
pre-commit hook, which is budgeted in seconds.

One file at a time, because a GUI under test is not a thing to parallelise: a
second suite competing for the machine changes how long a list takes to draw.
Where a scenario gives up it leaves a screenshot behind, named after what it was
waiting for and pointed at from the failure message, which on a runner nobody
watched is the difference between a diagnosis and another run.

Keys, the pointer and a controller, because the interface takes all three:
`useFocusable` binds `onMouseMove` and `onClick` beside the focus engine, and a
change that breaks one and not the other would otherwise go out. The pad is what
RomMix is designed around, so a scenario reaches a button by walking to it
unless another input is the subject.

Why the scenarios are split across the files they are, what a second application
in one file needs, and how typing and the pad are driven are documented where
they are done: the head of each file in [test/app/](test/app/), and
[driver.ts](test/app/driver.ts) beside them.

`npm run test:coverage` runs the same suite with Node's coverage report and a
floor under it. The floor is there to stop the number sliding, not to be aimed
at: a module worth adding is worth testing, and the report says which lines of
it nothing has run. Only files a test actually imports appear — the IPC wiring
and anything that drives Electron or spawns a process are deliberately absent,
and are covered by running the application.

Components are left out of it — every `.tsx` under `src/renderer/`, by extension
rather than by name, so a new component is covered by the rule the day it is
written and a module of rules stays measured wherever it sits. What a component
draws is `npm run test:app`'s to prove against a real window, and holding the
two `.test.tsx` files here to the same floor as a module of pure rules would
mean either a number nothing can honestly raise or a floor low enough to stop
meaning anything. `input/scroll.ts` is the one that reads oddly — it wants a
layout happy-dom has not got, so most of it can only be reached by running the
application — and it stays in the report anyway, because what it is low on is
worth being able to see.

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
every value it can take, and the compiler checks it alongside the real ones —
so adding a field to the interface breaks the example too, which is the point
of it.

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

Each type is bound to its schema by the name in its own doc comment — <code>GET
/api/users/me (`UserSchema`)</code> — so there is no table to keep beside it. A
`?` on a field means one supported version does not send it, and nothing else.

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

Most of what is worth unit-testing in here has been lifted into plain `.ts`
modules for exactly that reason — `input/geometry.ts`, `input/keyboard.ts`,
`history.ts`, `components/tiles.ts` — and the rule is worth keeping: a rule that
can be stated without a screen belongs where `npm test` can reach it, and the
component keeps the drawing. That is the cheapest kind of test here by a wide
margin.

A test that genuinely has to render is a `.test.tsx`, and there are two:
`input/focus.test.tsx`, which counts how much of the interface wakes up when the
highlight moves, and `paging.test.tsx`, which is the only thing that reaches
`useRomPages` at all. Both call `installDom` from
[src/renderer/src/test/dom.ts](src/renderer/src/test/dom.ts) before importing
React, and import everything after that dynamically, because a window has to
exist first. `scripts/test-resolve.mjs` compiles JSX with esbuild on the way in —
Node's own type stripping refuses `.tsx` — and resolves the extensionless
relative imports the renderer is written with, which the bundler otherwise does.

There is no layout in happy-dom: `getBoundingClientRect` answers zero for
everything and `getComputedStyle` comes back blank. So anything about where an
element _is_ cannot be asked here and is `npm run test:app`'s to answer.

A set of `data-*` attributes exists for `npm run test:app` and nothing else —
`data-screen` on the shell, `data-rom` on a game card, `data-action` on a
`FocusButton` a scenario presses, and one more for each kind of thing a scenario
has to find. They are there because every other handle on the interface changes:
the text with the language, the position with the next button added beside it.
`grep -rn 'data-' test/app/` is the list of them that cannot go stale. Add one
when a test needs it, not before.

Every screen is a folder under `screens/`, named after the screen and holding
`index.tsx` — the screen itself — with its own parts beside it: `Game/` keeps
its banner, its dialogs and its save hook, and its tabs in `tabs/`. A screen
that is still one file gets the folder anyway, so growing one is a new file
rather than a move. The folder is named for the screen's subject, which is also
the route it answers to (`Game/`, `{ name: 'game', romId }`).

`Wizards/` is the one folder holding screens rather than being one. Both of them
walk a player through a sequence of pages with a pad — first-run setup, and
installing an emulator — and both draw those pages with the `WizardPage` beside
them, which is what keeps the line over the heading, the place Back sits and
what B does the same in either.

Styles follow the same shape: `styles/index.css` imports one file per area of
the interface, and the import order there is the cascade.

### The linter

[oxlint](https://oxc.rs), not ESLint — originally because no published
`typescript-eslint` supports TypeScript 7, which this project is on, and since
kept for its own reasons: it lints the whole tree in well under a second, needs
no parser plugin, and carries the two rules worth having here,
`react/exhaustive-deps` and `react/rules-of-hooks`. Every rule switched off in
[.oxlintrc.json](.oxlintrc.json) says why it is off, and the standing TODO to
reconsider ESLint is there too, so that file is the place to argue with any of
this.

## House style

Prettier settles formatting; there is nothing to argue about there. The one
convention worth stating is the comments: they explain **why**, not what, and
they are specific enough to be checked. If a comment says RetroDECK writes a
file in a particular place, someone should be able to go and look. Vague
comments are worse than none, because they cannot be found to be wrong.

Keep user-facing copy short and concrete. A control says what happens, an error
says what went wrong and what to do about it.

Taking in something an older RomMix wrote comes in two shapes, and both are
migrations. One can be done at a known moment and recorded as done: that is a
named step in `src/main/migrations.ts`. The other cannot, because nothing knows
when every installation has been through it — a file under a name nothing
writes any more is found by whichever pull happens to touch that save — so it
lives on the path that finds it, and opens its comment with a
`MIGRATION(<version>)` token naming the last version that wrote the old shape:

```ts
/**
 * MIGRATION(0.11): take in the copy left beside the save by a version that
 * kept one there.
 */
```

One word for both on purpose. `grep -rn MIGRATION src/` is then the whole
answer to what is still being carried for old installations and how far back,
which is the question to ask before deciding a version is old enough to stop
supporting. It also marks the code as temporary, which a check sitting on a
read path does not otherwise admit to.

A shim that goes on reading an old shape without ever converting it is not this
and should not borrow the word: nothing about it says when it can go.

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

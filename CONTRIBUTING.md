# Contributing to RomMix

Thanks for looking. RomMix is a front end for [RomM](https://romm.app) that runs
on a television and is driven with a controller, and most of what makes it hard
is other people's software: five emulators, three packaging formats and a
different folder layout behind each one.

## Getting set up

Node 22.15 or newer. That is higher than the AppImage needs to build, and it is
`npm test` that asks for it — the suite runs TypeScript through Node's own type
stripping and a `module.registerHooks` loader, neither of which is available
before then.

```bash
git clone https://github.com/leclercb/rommix.git
cd rommix
npm install
npx install-electron   # Electron 43 no longer fetches its binary on install
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

## Where things live

`src/config/` is the part most changes belong in.

| You want to            | Edit                                               |
| ---------------------- | -------------------------------------------------- |
| Add a system           | the table in `src/config/systems.ts`               |
| Map a RomM platform    | the `slugs` column of that same row                |
| Say what a BIOS needs  | `src/config/bios.ts`                               |
| Teach a new ROM format | `src/config/romfiles.ts`                           |
| Add an emulator        | a folder under `src/config/emulators/` — see below |

**No code outside `src/config/` names an emulator.** That is a rule, not a
tendency: `src/main/emulators.ts` probes whatever the registry declares, and the
two prose lists that do name them — the table in the README and the one in
`site/index.html` — have to be edited by hand.

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

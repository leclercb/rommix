# RomMix

A Big Picture–style front end for a self-hosted [RomM](https://romm.app) server.

RomMix browses your RomM library like a console dashboard, downloads games into
RetroDECK's ROM folder, launches them in RetroDECK (or RetroArch), and syncs
your save files and save states back to RomM when you quit.

It is built for a TV or a handheld: controller-first, fullscreen, and happy
under gamescope or launched from Steam.

---

## Why Electron + React

The frontend had to run under gamescope, on a handheld, and from Steam, driven
entirely by a gamepad. That constraint decided the stack:

- **Chromium's Gamepad API is the most dependable controller input on Linux.**
  It needs no native dependency and behaves the same under gamescope (Wayland)
  and a normal desktop session. This is the single most important requirement
  and the main reason the alternatives lost.
- **A cover-art grid is a layout problem**, and CSS grid with GPU-composited
  transforms handles it well on Deck-class hardware.
- **The main process does the work the web cannot**: streaming multi-gigabyte
  downloads to disk, reading RetroDECK's configuration, and spawning another
  flatpak on the host.
- **Flathub has a well-trodden Electron path** (`org.electronjs.Electron2.BaseApp`
  plus zypak), so packaging is routine rather than research.

Considered and rejected: **Godot** (excellent pad handling, but awkward for
REST-driven, image-heavy list UIs), **Qt6/QML** (elegant and light, but a
heavier build and packaging story), and **Tauri** (WebKitGTK's gamepad support
under flatpak is exactly the thing we cannot afford to be shaky).

The cost is honest: an Electron app is roughly 250 MB installed. On a device
that stores ROMs, that is acceptable.

---

## How it fits together

```
RomM server ──HTTP──> main process ──> ~/retrodeck/roms/<system>/game.zip
                          │
                          └──flatpak-spawn──> flatpak run net.retrodeck.retrodeck -s <system> <game>
                                                          │
                                        saves ────────────┘
                          ┌───────────────────────────────┘
                          └──upload──> RomM /api/saves, /api/states
```

The renderer never talks to RomM directly. Every request crosses IPC to the main
process, so the access token stays out of the web context and downloads stream
straight to disk. Cover art is the one exception: it is served through a custom
`rommix-img://` protocol that attaches the auth header in the main process.

### Where files go

RomMix reads RetroDECK's own configuration at
`~/.var/app/net.retrodeck.retrodeck/config/retrodeck/retrodeck.json` to discover
the real ROM, save and state folders. It does **not** assume `~/retrodeck` —
that path is user-selectable and frequently points at an SD card.

ROMs are installed to `<roms_path>/<es-de system>/`. That layout is not
cosmetic: RetroDECK's `run_game` infers which emulator to use by matching the
`roms/<system>/` path segment, so a correctly placed file launches with no
further hints. Multi-file games (cue+bin, multi-disc) arrive from RomM as a zip
and are unpacked into their own directory.

The RomM platform slug is translated to an ES-DE system directory by
`src/shared/systems.ts`. When a platform has no mapping, RomMix **refuses to
guess** and tells you to pick a folder — installing to the wrong directory
fails silently at launch time, which is far worse than an upfront error.

### Emulators

Emulators are entries in a registry (`src/shared/emulators/`) rather than a
union type in the code. Each is a descriptor: how it might be installed, which
ES-DE systems it runs, where it keeps its folders, how its saves are laid out,
and one function that builds the argv to start a game. It is pure data, so it
is unit-tested without touching the filesystem; probing the machine — is it
installed, where did it actually put its config — is `src/main/emulators.ts`.

The split exists because a single "which emulator" setting was deciding four
things with different natural keys: ROMs belong to a *platform*, a process to a
*platform + emulator* pair, and BIOS layout to the emulator alone.

RetroDECK is a `frontend`, and deliberately opaque: it declares `'delegated'`
systems and is launched with `-s <system>`, so it resolves the emulator from
its own `es_systems.xml` and honours the user's `<altemulator>`. Enumerating
what it bundles would duplicate configuration RomMix does not own. Standalone
emulators declare the systems they run, and RomMix will not fall back to one
that cannot run the system in hand.

Because a frontend delegates *every* system, it also wins every fallback — so
a single-system emulator like Eden could never be selected by a global
preference alone. `settings.systemEmulators` pins one ES-DE system to one
emulator and is honoured strictly: a pin to something uninstalled is an error,
not a quiet substitution back to the frontend.

Not every emulator is a package. Eden ships only as an AppImage, so it is
found by filename in the usual download folders, or named outright in
`settings.emulatorPaths`. Where `appimage-run` exists it is used to start it,
because on NixOS an AppImage cannot execute itself.

### Save sync

Before launch, saves newer on the server are pulled down. After the emulator
exits, anything written during the session is uploaded. A remote save only
overwrites a local one when it is strictly newer, and the local file is copied
to `*.rommix-bak` first.

---

## Building

Requires Node 20+ and, for the flatpak, `flatpak` and `flatpak-builder`.

```bash
npm install
npm run typecheck   # tsc over main, preload and renderer
npm test            # platform-mapping tests
npm run dev         # run against a live RomM server on your desktop
```

Build the flatpak and install it for your user:

```bash
./scripts/build-flatpak.sh
```

That runs `npm run pack:dir` (electron-builder produces `dist/linux-unpacked/`),
then hands the tree to `flatpak-builder`.

> **Note on Flathub.** The manifest packages a *prebuilt* application tree. That
> is fine for a personal build, but Flathub requires a fully offline build. To
> submit, generate vendored npm sources with
> [`flatpak-node-generator`](https://github.com/flatpak/flatpak-builder-tools)
> and add them as sources alongside an `npm ci --offline` build step.

---

## Running it

```bash
flatpak run be.bl_it.RomMix                      # desktop
gamescope -f -- flatpak run be.bl_it.RomMix      # gamescope session
```

**From Steam:** add `flatpak run be.bl_it.RomMix` as a non-Steam game. RomMix
starts fullscreen and is fully navigable with the controller, so Big Picture
needs no extra configuration.

### Controls

| Button | Action |
| ------ | ------ |
| Left stick / D-pad | Navigate |
| A | Select |
| B | Back |
| Y | Jump to search |
| X / Start | Menu |
| Keyboard | Arrows, Enter, Escape, `/` for search |

---

## Connecting to RomM

Three ways to sign in, in the order that suits a controller:

1. **Pair this device** *(recommended on a TV)* — RomM issues a short code that
   you approve from a browser on your phone or desktop. Nothing secret is typed
   on the couch. Uses `POST /api/auth/device/init`.
2. **API token** — a long-lived `rmm_…` client token from RomM's
   Administration → Client tokens page.
3. **Username and password** — the OAuth2 password grant, refreshed silently.

RomMix requests only the scopes it needs: reading the library and platforms,
reading and writing assets (saves and states), and per-ROM user state.

---

## Troubleshooting

Settings → **Pre-flight check** names the common environmental failures
explicitly. The usual ones:

**"flatpak-spawn cannot reach the host"** — RomMix needs
`--talk-name=org.freedesktop.Flatpak` to start RetroDECK, because nested
`flatpak run` is impossible. Grant it in Flatseal.

**"The ROM folder is not writable"** — grant RomMix access to wherever your ROMs
live. `--filesystem=home` and `--filesystem=/run/media` are in the manifest, but
an unusual location needs adding manually.

**"RetroDECK has not been run yet"** — RetroDECK creates its folder layout on
first run. Start it once, then re-run the check.

**A platform installs nowhere / "RomMix does not know which folder…"** — add a
mapping in `settings.systemOverrides` (RomM platform slug → ES-DE folder name).

---

## Project layout

```
src/
  shared/     RomM 5.1.0 API types, platform mapping, emulator registry (+ tests)
  main/       store, RomM client, emulator probing, downloads, save sync, launcher
  preload/    the contextBridge surface
  renderer/   React UI — focus engine, components, screens
flatpak/      manifest, desktop entry, metainfo, icon
scripts/      build-flatpak.sh
```

The API types in `src/shared/types.ts` were derived from a RomM 5.1.0 instance's
`/openapi.json` rather than from documentation, so the field names match what
the server actually returns.

## Licence

MIT.

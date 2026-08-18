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
RomM server ──HTTP──> main process ──> <library>/<system>/game
                          │
                          │  platform -> emulator (settings, else registry default)
                          │
                          └──flatpak-spawn──> flatpak run …retrodeck -s <system> <game>
                                              /path/to/Eden.AppImage <game>
                                              retroarch -L <core> <game>
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

Everything RomMix owns lives in one folder, `~/rommix` by default and
relocatable from Settings: `config/` (settings, credentials, the installed
index) and `emulators/` (anything RomMix downloaded). Because the setting
saying where the root is would otherwise live inside the root, it is resolved
from `ROMMIX_HOME`, then a one-line pointer at `~/.config/rommix/root`, then
the default.

ROMs are the exception, and go to a single **library root** shared by every
emulator — by default whatever folder the emulator for that platform already
uses, so a RetroDECK library stays where ES-DE scrapes it. RetroDECK's own
configuration is read from
`~/.var/app/net.retrodeck.retrodeck/config/retrodeck/retrodeck.json` rather
than assuming `~/retrodeck`, since that path is user-selectable and frequently
points at an SD card. One root works because every emulator is handed an
absolute path at launch, so a ROM never has to sit inside the tree of the
program that opens it.

The layout is `<library>/<es-de system>/`, which is not cosmetic: RetroDECK
infers the emulator from that path segment, and ES-DE scrapes the same shape.
A single-file ROM lands as a file even when RomM zipped it for transport;
genuine multi-file games (cue+bin, multi-disc) are unpacked into a directory,
and the file to launch is chosen from it — the `.m3u` or `.cue` rather than the
much larger `.bin` it references.

The RomM platform slug is translated to an ES-DE system directory by
`src/shared/systems.ts`. When a platform has no mapping, RomMix **refuses to
guess** and tells you to pick a folder — installing to the wrong directory
fails silently at launch time, which is far worse than an upfront error.

`installed.json` records what was downloaded, but it is a cache rather than the
authority: as library pages load, RomMix checks whether each ROM is already
sitting where it would have installed it and adopts what it finds. Moving the
RomMix folder, restoring a backup or copying ROMs in by hand therefore does not
make a full library look empty.

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

**Every emulator declares a concrete platform list, frontends included.**
RetroDECK is still launched with `-s <system>` so that it picks the emulator
from its own `es_systems.xml` and honours the user's `<altemulator>` — RomMix
never reaches past it. But it does not get to claim it runs everything: it
ships no Switch emulator, and an earlier design where a frontend declared
"it decides for itself" read as "all platforms" and silently routed Switch ROMs
into a program that could not open them. A list that can be wrong and corrected
beats a claim that cannot be checked.

Which emulator runs a platform is therefore an explicit map,
`settings.systemEmulators`, with defaults derived from the registry: the first
emulator that declares the platform, frontends first. A recorded choice is
honoured **strictly** — an emulator that is not installed is reported rather
than silently swapped — while an unset platform falls back to the first
*available* emulator that covers it.

Not every emulator is a package. Eden ships only as an AppImage, so it is found
by filename in RomMix's own `emulators/` folder, then the usual download
folders, or named outright in `settings.emulatorPaths`. RomMix can also fetch
it: the descriptor carries a release endpoint, and Settings offers the builds
that endpoint actually published, filtered to assets that can run. AppImages
are executed directly — wrapping them in `appimage-run` breaks the newer ones,
whose payload is DwarFS rather than squashfs.

### Save sync

Before launch, saves newer on the server are pulled down. After the emulator
exits, anything written during the session is uploaded. A remote save only
overwrites a local one when it is strictly newer, and the local file is copied
to `*.rommix-bak` first.

How much of this is possible depends on the emulator, which is why a descriptor
declares a `saveLayout`. One file named after the ROM (libretro `.srm`) syncs
cleanly. A directory keyed by title id — Eden's `nand/user/save` — does not
match on filename, and an emulator whose games share one memory card has no
per-game save to attribute at all; those are skipped rather than uploading one
game's data under another's name.

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
`--talk-name=org.freedesktop.Flatpak` to start an emulator on the host, because
nested `flatpak run` is impossible. Grant it in Flatseal.

**"The ROM folder is not writable"** — grant RomMix access to wherever your ROMs
live. `--filesystem=home` and `--filesystem=/run/media` are in the manifest, but
an unusual location needs adding manually.

**"RetroDECK has not been run yet"** — RetroDECK creates its folder layout on
first run. Start it once, then re-run the check.

**A platform installs nowhere / "RomMix does not know which folder…"** — add a
mapping in `settings.systemOverrides` (RomM platform slug → ES-DE folder name).

**"No installed emulator can run …"** — nothing on the machine declares that
platform. Settings → **Platforms** shows what each one resolves to; Settings →
**Emulators** shows what is installed and what each covers.

**An AppImage emulator will not start on NixOS** — AppImages need a loader for
the binaries inside (`programs.nix-ld.enable`), and must *not* be routed through
`appimage-run` (`programs.appimage.binfmt = false`), which only understands a
squashfs payload and fails on the DwarFS ones newer builds use.

---

## Project layout

```
src/
  shared/     RomM 5.1.0 API types, platform mapping, emulator registry (+ tests)
  main/       root layout, store, RomM client, emulator probing and install,
              downloads, save sync, launcher
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

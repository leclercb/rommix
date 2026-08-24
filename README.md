# RomMix

A Big Picture–style front end for your own [RomM](https://romm.app) server.

Browse your library like a console dashboard, download games into your emulator's
ROM folder, launch them, and sync saves and save states back to RomM when you
quit. Built for a desktop, a handheld or a TV: fullscreen, driven entirely by a
controller, at home under gamescope or launched from Steam.

**[rommix on the web →](https://leclercb.github.io/rommix/)** — what it is, and a
[live demo](https://leclercb.github.io/rommix/demo/) of the interface running in
your browser, browsing the homebrew library from
[RomM's public demo](https://demo.romm.app). Nothing is installed and no server
is involved: it is the front end alone, for looking at rather than using.

---

## Requirements

- **Linux**, on x86_64 or arm64. `flatpak` too, if you want the emulators that
  are packaged that way — RetroDECK, RetroArch and shadPS4. RomMix itself needs
  neither. RomMix adds the Flathub remote for your user the first time you
  install one of them, so a distribution that ships flatpak with no remotes
  configured needs nothing done by hand.
- **A RomM server** you can reach, version 5.x or newer, with an account on it.
- **At least one emulator.** These are the five RomMix knows how to drive:

  | Emulator      | Covers                                    | Automatic installation supported              |
  | ------------- | ----------------------------------------- | --------------------------------------------- |
  | **RetroDECK** | 79 systems, the NES to the PS3            | ✅ Flatpak                                    |
  | **EmuDeck**   | 74 systems, the NES to the Switch and 360 | ❌ Its own installer, see [EmuDeck](#emudeck) |
  | **RetroArch** | 69 systems, one libretro core each        | ✅ Flatpak                                    |
  | **Eden**      | Nintendo Switch                           | ✅ AppImage                                   |
  | **shadPS4**   | PlayStation 4                             | ✅ Flatpak and AppImage                       |

  RetroDECK and EmuDeck are front ends rather than emulators: each carries a
  dozen of its own — Dolphin, DuckStation, PCSX2, RPCS3, melonDS, Cemu, Ryujinx
  and the rest — and RomMix hands a game to whichever one that system is
  configured for. RetroArch runs the libretro core RomMix names for the system,
  47 of them across those 69. Eden and shadPS4 each run one console and nothing
  else. Settings → **Platforms** shows what every system resolves to.

  Start with RetroDECK if you have none of them: it covers the most platforms and
  picks the right emulator for each system itself. EmuDeck works too, but run its
  own installer first — RomMix does not install it.

- **A controller** is recommended but not required.

---

## Install

Download the AppImage for your machine from
[Releases](https://github.com/leclercb/rommix/releases) — `x86_64` for an
ordinary PC or a Steam Deck, `arm64` for an ARM handheld or single-board
machine. `uname -m` says which you are on.

```bash
chmod +x RomMix-<version>-x86_64.AppImage
./RomMix-<version>-x86_64.AppImage
```

Or build it yourself, which needs Node 22.15 or newer — that is what `npm test`
asks for, the suite running TypeScript through Node's own type stripping:

```bash
git clone https://github.com/leclercb/rommix.git
cd rommix
npm install
npm run appimage        # writes dist/RomMix-<version>-<arch>.AppImage
```

That builds for the machine you are on. `npm run package -- --arm64` targets the
other one, though cross-packaging fetches a foreign Electron — CI builds each
architecture on a runner of its own.

### Run it

```bash
./RomMix-x86_64.AppImage                    # desktop
gamescope -f -- ./RomMix-x86_64.AppImage    # gamescope session
```

### From Steam

Download `rommix-steam.sh` from the same release, keep it **beside** the
AppImage, and add the _script_ as the non-Steam game:

```bash
chmod +x RomMix-<version>-x86_64.AppImage rommix-steam.sh
```

RomMix starts fullscreen and is fully navigable with a controller, so Big
Picture needs no other setup.

The script exists because Steam launches a game with `PR_SET_NO_NEW_PRIVS`, and
the kernel ignores the setuid bit on anything started that way. `fusermount` is
setuid, so an AppImage launched straight from Steam cannot mount itself and dies
with `Cannot mount AppImage` before RomMix runs at all. This is a property of
how Steam launches things, not of any one distribution. The script sets
`APPIMAGE_EXTRACT_AND_RUN`, which unpacks to a temporary directory instead and
needs no privileges.

It `exec`s the AppImage rather than starting it and waiting, which matters:
RomMix has to remain the emulator's parent process, because Steam tags the
windows of the tree it launched and a gamescope session only focuses a window
Steam has tagged. An emulator started outside that tree runs perfectly well on a
display you cannot reach — RomMix keeps focus, and the game is missing from
Steam's window switcher. Anything you put in front of RomMix has to preserve
that, so `exec` rather than launch-and-return.

> **Why not a flatpak?** That is exactly what RomMix used to ship as, and it is
> what caused the problem above. A sandboxed application cannot start a program
> on the host directly — it goes out through `flatpak-spawn --host`, which hands
> the process to flatpak's session helper and so reparents it out of Steam's
> tree. An AppImage is not a sandbox, so the emulator is an ordinary child
> process and everything downstream of that just works.

### Permissions

None. RomMix runs as an ordinary program with your own user's access, so there
is nothing to grant and nothing to tighten.

Controllers need no setup either: Chromium reads them from `/dev/input`, and
udev's device database is readable where any other program on the machine can
read it. Settings → **Pre-flight check** names the pad it can see, if any.

---

## Signing in

On first launch RomMix asks for your server address and how to sign in:

1. **Pair this device** _(best on a TV)_ — RomMix shows a code and a QR code.
   Scan it, or open the address in any browser, and approve the request in RomM.
   Nothing secret is typed on the couch.
2. **API token** — an `rmm_…` token from RomM's _Administration → Client tokens_.
3. **Username and password**.

Credentials are stored in `~/rommix`, encrypted with the system keyring, or in a
file readable only by you where no keyring is reachable.

---

## Controls

| Button             | Action                                |
| ------------------ | ------------------------------------- |
| Left stick / D-pad | Navigate                              |
| A                  | Select                                |
| B                  | Back                                  |
| X / Start          | Open Settings                         |
| Y                  | Search                                |
| LB / RB            | Previous / next tab, on a game's page |

Keyboard: arrows, Enter, Escape or Backspace to go back, Tab and Shift-Tab for
tabs, `/` to search, `m` for Settings.

---

## Using it

- **Home** — the game you last played, what is already on this device, your
  favourites and recent additions.
- **Library** — everything on your server, searchable and filterable by platform.
  A dot on a cover means the game is downloaded.
- **A game's page** — download, play, uninstall, and see what RomM holds for it.
  Downloads run one at a time and continue while you browse. Where an emulator
  offers more than one way to run a platform, RomMix asks once and remembers;
  **Run with…** changes the answer later.
- **Downloads** — the queue, and everything on this device grouped by platform.
  **Sync with disk** rechecks your library against the folders on this machine:
  it forgets games you deleted by hand and adopts ROMs you copied in yourself.
- **BIOS** — per platform, which files are needed, which your RomM server holds,
  and whether the emulator already has them, then copies the missing ones into
  place. BIOS files come from your own server only: upload them to RomM under a
  platform. Switch, PS3, Vita, 3DS and Wii U need a dump from a real console
  instead, and say so.

---

## Settings

### Interface

**Scale** — how large the interface is drawn. It is laid out for a 1080p
television, so on a 4K one **Auto** doubles it and everything is back at the
size it is meant to be read at from a sofa. Pick a number instead if your panel
is further away than that, or nearer.

A desktop that already scales for itself — 4K at 200% — is left alone: it is
being scaled once already.

### Emulators

What RomMix found, what each one covers and where it keeps its games. Buttons
install RetroDECK, RetroArch or shadPS4 from Flathub, download Eden or shadPS4 as
an AppImage, or **Run** an emulator on its own — needed for the setup only the
emulator can do: RetroDECK creates its folders on first run, RetroArch needs its
cores, Eden needs its keys, and shadPS4 has to be told where the games are.

### EmuDeck

Install [EmuDeck](https://www.emudeck.com) with its own installer and finish its
setup first; RomMix then finds it and needs no configuration. It reads your
`Emulation` folder from EmuDeck's settings, so a library on an SD card is found
without being told, and it launches games through the scripts in
`Emulation/tools/launchers/` — so EmuDeck's own configuration, including its
cloud save sync, is what runs the game.

Where EmuDeck installed several emulators for one system, RomMix asks which to
use the first time you play something on that platform.

### Platforms

One row per platform, showing which emulator runs it. Press to cycle through the
emulators that can run it; left alone, each platform uses a sensible default. A
platform you pin to a missing emulator reports that rather than quietly using
another one.

Each emulator keeps its games in its own folder, so pointing a platform elsewhere
means RomMix offers those games for download again. Nothing is deleted, and
pointing it back brings them straight back.

### Save sync

- **Download newer saves before playing** — only ever replaces a local save that
  is _older_, and keeps the local file as `*.rommix-bak` first.
- **Upload saves after playing** — sends back only the files the session wrote.
- **Ask before sending saves to RomM** — on by default. Lists the files first
  and sends only what you approve; what you decline stays on this device. The
  dialog's **Send and don't ask again** turns this off from where it is asked.

A game's **Saves** tab pulls or pushes by hand, and marks each file in sync,
newer here, newer on RomM, or missing from one side.

Saves named after the ROM sync cleanly. Switch-family emulators key saves by
title id, which RomMix resolves from the ROM itself. Emulators that share one
memory card between every game cannot be synced, and RomMix says so rather than
uploading the wrong data.

### Downloads

- **Ask before deleting a downloaded game** — on by default.

### RomMix folder

Everything RomMix owns lives in `~/rommix`: settings, credentials, the index of
downloaded games and any emulator RomMix installed. Set a new path here and
RomMix copies it across and restarts; your ROMs and emulators stay where they
are. `ROMMIX_HOME` overrides this.

### Settings that are not on screen

Two rare options live in `~/rommix/config/settings.json`, in the `"settings"`
object. Close RomMix before editing it.

- **`systemOverrides`** — for a platform RomMix has no folder for. Maps a RomM
  platform slug to an ES-DE system folder:

  ```json
  "systemOverrides": { "sega-pico": "segapico" }
  ```

- **`emulatorPaths`** — for an emulator kept somewhere RomMix would not look:

  ```json
  "emulatorPaths": { "eden": "/mnt/games/Eden.AppImage" }
  ```

---

## Where your files go

| What                                  | Where                                     |
| ------------------------------------- | ----------------------------------------- |
| ROMs                                  | The running emulator's `<roms>/<system>/` |
| Saves and states                      | The emulator's own save folders           |
| BIOS files                            | The emulator's own BIOS folder            |
| Settings, credentials, download index | `~/rommix/config/`                        |
| Emulators RomMix installed            | `~/rommix/emulators/`                     |
| Log file                              | `~/rommix/logs/rommix.log`                |

ROMs go into each emulator's own library rather than a folder of RomMix's own, so
a game is still there when you start that emulator yourself and ES-DE scrapes it
as usual. RetroDECK's library is wherever you told RetroDECK to put it, SD card
included.

A multi-file game — cue+bin, or a multi-disc set — is unpacked into its own
folder, and RomMix hands the emulator the `.m3u` or `.cue` rather than the `.bin`.

---

## Troubleshooting

Settings → **Pre-flight check** names the common problems, and **Re-run check**
re-tests after you fix one.

**RomMix does not start at all, or the Steam shortcut appears to do nothing**
Run it from a terminal first — an AppImage that cannot start says why there and
nowhere else. If it starts from a terminal but not from Steam, look in
`~/.local/share/Steam/logs/console-linux.txt`, which is where Steam keeps what
the shortcut printed.

`mount failed: Operation not permitted`, or `No suitable fusermount binary
found on the $PATH`. **This one is not distribution-specific.** Steam launches a
game with `PR_SET_NO_NEW_PRIVS`, and the kernel ignores the setuid bit on any
process started that way — so `fusermount` cannot mount anything and the
AppImage never unpacks itself. No `PATH` or `FUSERMOUNT_PROG` value changes
that. Use `rommix-steam.sh` from the release and point the shortcut at it — see
[From Steam](#from-steam).

`error while loading shared libraries: libnspr4.so` (or `libglib-2.0.so.0`).
The distribution does not ship the libraries an unpatched binary expects, which
on a normal Debian, Ubuntu or Fedora install it does. On NixOS it needs
answering **twice**, because Steam runs games inside its own FHS environment
where `/lib64/ld-linux-x86-64.so.2` is the real glibc loader rather than
nix-ld's shim — so `programs.nix-ld` fixes a terminal launch and does nothing at
all for a Steam one:

```nix
# For running RomMix directly. Appended, because assigning this option replaces
# nixpkgs' own default set and would break every other AppImage on the machine.
programs.nix-ld.enable = true;
programs.nix-ld.libraries =
  options.programs.nix-ld.libraries.default ++ electronLibraries;

# For running it from Steam.
programs.steam.extraPackages = electronLibraries;
```

where `electronLibraries` is, with `pkgs`:

```nix
[
  alsa-lib at-spi2-core cairo cups dbus expat fontconfig freetype glib gtk3
  libdrm libgbm libglvnd libx11 libxcb libxcomposite libxcursor libxdamage
  libxext libxfixes libxi libxkbcommon libxrandr libxrender libxshmfence
  libxtst nspr nss pango
]
```

Also on NixOS: leave `programs.appimage.binfmt` off. It routes every AppImage
through `appimage-run`, which unpacks a squashfs payload — and an image built
with uruntime carries DwarFS, so it dies on "Can't find a valid SQUASHFS
superblock" before its own runtime gets a chance.

**"flatpak is not installed"**
Most of the emulators RomMix drives are packaged as flatpaks, so without the
command none of them can be found or installed. Install it from your
distribution and re-run the check.

**"Flathub is not set up for your user"**
A distribution can ship flatpak with no remotes at all — Debian, Ubuntu and Arch
do — or with Flathub filtered until you enable it, as Fedora does. Then every
emulator reads "not installed" while the flatpak row says yes. RomMix adds the
remote itself the first time you install an emulator; to do it by hand:

```bash
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

**"… has not been run yet, so its folders do not exist"**
Press **Run** beside it in Settings → Emulators, let it start, then re-run the
check.

**"The ROM folder is not writable"**
Check the folder's permissions, and that the drive it is on is mounted.

**"No installed emulator can run …"**
Nothing here covers that platform. Settings → Platforms shows what each one
resolves to; Settings → Emulators shows what is installed.

**"RomMix does not know which folder … maps to"**
Add a `systemOverrides` entry, as above.

**The game starts but RomMix keeps focus, and Steam does not list its window**
Something is launching the emulator outside the process tree Steam started.
A gamescope session only focuses a window Steam has tagged, and Steam only tags
what it launched — so add the AppImage to Steam directly, or a script that
`exec`s it, and nothing that hands it off to another process.

**A game shows as not downloaded even though the file is there**
Its platform is pointed at a different emulator now, and the file is in the
previous one's library. Point it back, or download a copy for the new one.

**The controller does nothing**
Press a button on it and check Settings → **Pre-flight check**: Chromium hides
pads from a page until one is used, so the name only appears after the first
press. A pad named there but followed by `(unmapped)` is one Chromium does not recognise; the buttons
RomMix uses still work, and any that do not are worth reporting with that name.

**The interface is tiny on a 4K television**
Settings → Interface → **Scale**. Auto should already have doubled it, so a
screen that reports a resolution it is not actually running at is the usual
cause — set 200% by hand.

**An AppImage emulator will not start on NixOS**
AppImages need `programs.nix-ld.enable`, and must _not_ go through
`appimage-run` (`programs.appimage.binfmt = false`).

### The log

Everything RomMix does goes to `~/rommix/logs/rommix.log` — the command each
emulator was started with and the code it exited on, what was asked of the RomM
server and what came back, where each ROM, save and BIOS file was written. It is
the file to read when something fails silently, and the one to attach to a bug
report. Settings → **Pre-flight check** names its exact location.

```bash
tail -f ~/rommix/logs/rommix.log
```

Credentials are stripped on the way in, so a log is safe to paste as it is.

It rolls over at 5 MB, keeping the previous one as `rommix.log.1`. For more
detail — every request, every emulator probe, download progress — start RomMix
with `ROMMIX_LOG=debug`; `ROMMIX_LOG=off` writes nothing at all.

---

## Development

```bash
npm install
npx install-electron   # Electron 43 no longer fetches its binary on install
npm run dev            # against a live RomM server on your desktop
npm run preview:app    # the front end alone, in a browser, on :5273
npm run preview:web    # the whole public site, built and served, on :5274
npm run format:check
npm run lint
npm run typecheck
npm test
npm run appimage       # build dist/RomMix-<version>-<arch>.AppImage
```

Those four checks are what CI runs, in that order, on every push and pull
request — and what `npm run release` refuses to cut a tag without.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the rest.

The linter is [oxlint](https://oxc.rs) rather than ESLint, and not by
preference: no published `typescript-eslint` supports TypeScript 7, which this
project is on. oxlint parses TypeScript itself and carries the two rules that
earn a linter its place here — `react/exhaustive-deps` and
`react/rules-of-hooks`. Its configuration is [.oxlintrc.json](.oxlintrc.json),
where every rule that is switched off says why.

Tests run under `node --test`. `src/config/` and `src/shared/` are pure and test
directly; `src/main/` needs two things Node does not supply on its own — the
`@shared`/`@config` aliases, and a stand-in for `electron` — which is what
[scripts/test-resolve.mjs](scripts/test-resolve.mjs) is. That is also why every
relative import in `src/main/` carries an explicit `.ts`: the bundler does not
mind either way, and without it the test runner cannot load the module at all.

Instead of `npx install-electron` you can point `ELECTRON_EXEC_PATH` at a system
Electron, which is what `.envrc` does here. Packaging is unaffected either way.

`src/config/` holds the platform table, the RomM slug mapping, the emulator
registry, the BIOS requirements and the ROM-format tables. **Adding a system, a
BIOS requirement or an emulator is a change in `src/config/` and nowhere else** —
no code outside it names an emulator. The two lists that do are prose and have
to be edited by hand: the table above and the one in `site/index.html`.

For a new emulator, start from
[src/config/emulators/example/index.ts](src/config/emulators/example/index.ts):
a complete annotated descriptor that documents every field and every value it
can take, and that the compiler checks along with the five real ones. Copy it to
`src/config/emulators/<your emulator>/index.ts`, delete the branches that do not
apply, and add it to the registry in
[src/config/emulators/index.ts](src/config/emulators/index.ts).

### The web preview and the site

`npm run preview:app` serves the renderer as an ordinary web page, for looking at
the front end where starting Electron is not worth it — a headless box, or a
remote session. There is no preload script in a browser, so
`src/renderer/src/dev/bridge.ts` answers every call from a library held in
memory. It is a mannequin: nothing is persisted, nothing reaches a RomM server,
and anything that would touch a disk or an emulator reports plausible success
without doing it. The module is behind the `VITE_WEB_PREVIEW` flag that
`vite.web.config.ts` sets, so it is never part of a shipped bundle.

That library is `src/renderer/src/dev/library.ts`, a transcript of
[RomM's own public demo](https://demo.romm.app) — 25 games across 13 systems,
with the metadata and the cover art that server holds, which is homebrew and
freeware throughout and so can be shown in public. The art lives in
`demo/`, deliberately outside `src/`: it is the preview build's
`publicDir`, because anything the renderer _imports_ is emitted into the
application build as well, whether or not the code importing it survives
tree-shaking.

```bash
npm run build:site     # out/site: the landing page, with the preview in demo/
npm run preview:web    # the same, built and then served on :5274
```

The landing page needs the built site rather than the raw file: its cover art
and both of its links into the demo point at `./demo/`, which only exists once
`build:site` has put it there. Opening `site/index.html` from disk shows the
page with neither.

That same preview is what is published at
[leclercb.github.io/rommix/demo/](https://leclercb.github.io/rommix/demo/), beside
the one-page site in [site/index.html](site/index.html).
[.github/workflows/pages.yml](.github/workflows/pages.yml) runs
`npm run build:site` and deploys `out/site` on a push to `main` that touched the
site or the renderer. Pages has to be enabled once in the repository settings,
with **Source** set to _GitHub Actions_.

### Releasing

```bash
npm run release minor          # or major, patch, or an exact version
npm run release -- --dry-run   # npm eats flags that come without the --
```

[release-it](https://github.com/release-it/release-it) runs the checks, bumps the
version, writes the [CHANGELOG.md](CHANGELOG.md) entry, commits, tags and pushes.
[.github/workflows/release.yml](.github/workflows/release.yml) builds the AppImage
on every push and, for a `v*` tag, publishes a release with the image attached.
A version with a suffix — `0.2.0-rc1` — publishes as a pre-release.

The changelog entry the hook writes falls back to commit subjects, so for a real
release commit a hand-written `## <version>` section in
[CHANGELOG.md](CHANGELOG.md) first and its prose will be left alone. The date is
stamped at release time either way, so whatever you write beside the version
does not matter.

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) — how to get set up, what CI checks, and
where each kind of change belongs. Adding an emulator or a platform is a
self-contained change in `src/config/`.

Security reports go through
[private vulnerability reporting](https://github.com/leclercb/rommix/security/advisories/new)
rather than a public issue — see [SECURITY.md](SECURITY.md).

---

## Licence

MIT — see [LICENSE](LICENSE).

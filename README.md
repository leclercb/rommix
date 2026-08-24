# RomMix

A Big Picture–style front end for your own [RomM](https://romm.app) server.

Browse your library like a console dashboard, download a game into your
emulator's ROM folder, play it, and let your saves go back to RomM when you
quit. Fullscreen and controller-driven, on a desktop, a handheld or a TV.

**[rommix on the web →](https://leclercb.github.io/rommix/)** — with a
[live demo](https://leclercb.github.io/rommix/demo/) of the interface in your
browser, on the homebrew library from [RomM's public demo](https://demo.romm.app).

---

## Features

- **Your library, laid out for a screen.** Shelves for what you were last
  playing, what is on this device and your favourites; everything else
  searchable and filtered by platform.
- **Driven with a controller.** Every screen reachable on a D-pad, fullscreen,
  and drawn at double size on a 4K panel so it still reads from a sofa.
- **Downloads into your emulator's own folder.** SD card included — or into one
  shared folder you point every emulator at. The queue keeps running while you
  browse.
- **Multi-disc handled.** A cue+bin or a multi-disc set is unpacked into its own
  folder, and the emulator is handed the `.m3u` or `.cue`, not the `.bin`.
- **Saves both ways.** Newer saves and states come down before you play and go
  back up when you quit, after showing you what is about to be sent. A per-game
  tab marks which side is ahead and pulls or pushes by hand.
- **BIOS from your own server.** Per platform: what is needed, what RomM holds
  and what the emulator already has — then the missing files are put in place.
- **It installs the emulators.** RetroDECK, RetroArch and shadPS4 from Flathub,
  Eden as an AppImage, all from Settings — and it picks which one runs each
  platform, which you can change per platform.
- **Sign in from the couch.** A code and a QR approved in RomM from your phone.
  Credentials are encrypted with the system keyring.
- **Pre-flight check.** Names what is actually wrong — flatpak missing, no
  emulator, an unwritable ROM folder — instead of failing at launch.
- **It keeps itself current.** Nothing updates an AppImage for you, so RomMix
  watches its own releases, says when one is out, and swaps the image in for the
  next start — or leaves it to you, if you would rather.

---

## Requirements

- **Linux**, x86_64 or arm64. Plus `flatpak` for the emulators packaged that
  way; RomMix adds the Flathub remote itself the first time you install one.
- **A RomM server** you can reach, version 5.x or newer, with an account.
- **A controller**, recommended but not required.
- **At least one emulator**, from the five RomMix drives:

  | Emulator      | Covers                                    | Installed by RomMix                           |
  | ------------- | ----------------------------------------- | --------------------------------------------- |
  | **RetroDECK** | 79 systems, the NES to the PS3            | ✅ Flatpak                                    |
  | **EmuDeck**   | 74 systems, the NES to the Switch and 360 | ❌ Its own installer, see [EmuDeck](#emudeck) |
  | **RetroArch** | 69 systems, one libretro core each        | ✅ Flatpak                                    |
  | **Eden**      | Nintendo Switch                           | ✅ AppImage                                   |
  | **shadPS4**   | PlayStation 4                             | ✅ Flatpak and AppImage                       |

  RetroDECK and EmuDeck are front ends carrying a dozen emulators each, and a
  game goes to whichever one that system is configured for; RetroArch runs the
  libretro core RomMix names for the system; Eden and shadPS4 each run one
  console. Settings → **Platforms** shows what every system resolves to. Start
  with RetroDECK if you have none — it covers the most platforms and picks the
  emulator for each system itself.

---

## Install

Download the AppImage from
[Releases](https://github.com/leclercb/rommix/releases) — `x86_64` for a PC or a
Steam Deck, `arm64` for an ARM handheld (`uname -m` says which). Nothing is
installed and no permissions are needed.

```bash
chmod +x RomMix-x86_64.AppImage
./RomMix-x86_64.AppImage                    # desktop
gamescope -f -- ./RomMix-x86_64.AppImage    # gamescope session
```

No version in the file name: updates are written over that same file, so
shortcuts keep working. Settings says which version you have.

### From Steam

Download `rommix-steam.sh` from the same release, keep it **beside** the
AppImage, and add the _script_ as the non-Steam game — Steam cannot launch an
AppImage directly.

```bash
chmod +x RomMix-x86_64.AppImage rommix-steam.sh
```

### Build it yourself

Node 22.15 or newer.

```bash
git clone https://github.com/leclercb/rommix.git
cd rommix
npm install
npm run appimage        # writes dist/RomMix-<arch>.AppImage
```

That builds for the machine you are on; `npm run package -- --arm64` targets the
other one.

---

## Signing in

On first launch RomMix asks for your server address and one of:

1. **Pair this device** _(best on a TV)_ — a code and a QR to approve in RomM.
2. **API token** — an `rmm_…` token from RomM's _Administration → Client tokens_.
3. **Username and password**.

Credentials live in `~/rommix`, encrypted with the system keyring, or in a file
readable only by you where no keyring is reachable.

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

- **Home** — the game you last played, what is on this device, your favourites
  and recent additions.
- **Library** — everything on your server, searchable and filtered by platform.
  A dot on a cover means the game is downloaded.
- **A game's page** — download, play, uninstall, and what RomM holds for it.
  Where an emulator offers more than one way to run a platform, RomMix asks once
  and remembers; **Run with…** changes the answer later.
- **Downloads** — the queue, and everything on this device by platform. **Sync
  with disk** forgets games you deleted by hand and adopts ROMs you copied in.
- **BIOS** — per platform, then copies the missing files into place. They come
  from your own server only: upload them to RomM under a platform. Switch, PS3,
  Vita, 3DS and Wii U need a dump from a real console instead, and say so.

---

## Settings

Four tabs — **General**, **Emulators**, **Games**, **System** — with LB/RB (or
Tab) to move between them.

**Interface → Scale.** The interface is laid out for a 1080p television, so
**Auto** doubles it on a 4K one. Pick a number if your panel is nearer or
further away. A desktop that already scales itself is left alone.

**Emulators.** What RomMix found, what each covers and where it keeps its games.
Buttons install them, or **Run** one on its own — needed for the setup only the
emulator can do: RetroDECK creates its folders on first run, RetroArch needs its
cores, Eden its keys, shadPS4 to be told where the games are.

**Games on disk.** Downloads go to each emulator's own ROM folder, or to one
RomMix folder you point every emulator at — everything in one place, and
changing which emulator runs a platform then moves nothing.

**Platforms.** One row per platform, showing which emulator runs it; press to
cycle. Each emulator keeps games in its own folder, so pointing a platform
elsewhere means RomMix offers those games for download again. Nothing is
deleted, and pointing it back brings them straight back.

**Save sync.**

- **Download newer saves before playing** — only ever replaces an _older_ local
  save, keeping it as `*.rommix-bak` first.
- **Upload saves after playing** — sends only what the session wrote.
- **Ask before sending saves to RomM** — on by default. Lists the files and
  sends only what you approve; **Send and don't ask again** turns it off from
  the dialog itself.

Saves named after the ROM sync cleanly, and Switch-family saves are matched by
title id. Emulators that share one memory card between every game cannot be
synced, and RomMix says so rather than uploading the wrong data.

**Downloads → Ask before deleting a downloaded game**, on by default.

**RomMix folder.** Settings, credentials, the download index and any emulator
RomMix installed live in `~/rommix`. Set a new path and RomMix copies it across
and restarts; ROMs and emulators stay where they are. `ROMMIX_HOME` overrides it.

**Updates → New versions of RomMix.** Nothing updates an AppImage for you, so
RomMix checks its own
[releases](https://github.com/leclercb/rommix/releases) half a minute after
starting, then every six hours.

- **Automatic**, the default — downloaded in the background, used at the next
  start. Nothing restarts on its own; **Restart now** is there if you want it.
- **Tell me** — notification and a version badge on Settings; nothing is
  downloaded until you press **Download**.
- **Off** — never checks by itself. **Check now** still does.

The new image is written over the file you run, so shortcuts keep working and
nothing is renamed. It is safe while running: the image is renamed into place
and the running copy keeps reading the file it started from.

Two cases RomMix cannot finish on its own, both of which it says on screen:
**started from Steam**, where Steam forbids a program restarting itself — quit
and press Play again; and an image it **cannot write to** or was not started
from, where the check still reports the new version and the releases page is the
way to get it.

### EmuDeck

Install [EmuDeck](https://www.emudeck.com) with its own installer and finish its
setup; RomMix then finds it and needs no configuration. It reads your
`Emulation` folder from EmuDeck's settings, so a library on an SD card is found
without being told, and it launches games through `Emulation/tools/launchers/` —
EmuDeck's own configuration, cloud saves included, is what runs the game.

Where EmuDeck installed several emulators for one system, RomMix asks which to
use the first time you play something on that platform.

### Settings that are not on screen

Two rare options live in `~/rommix/config/settings.json`. Close RomMix before
editing it.

```json
{
  "settings": {
    "systemOverrides": { "sega-pico": "segapico" },
    "emulatorPaths": { "eden": "/mnt/games/Eden.AppImage" }
  }
}
```

`systemOverrides` maps a RomM platform slug to an ES-DE system folder, for a
platform RomMix has none for. `emulatorPaths` points at an emulator kept
somewhere RomMix would not look.

---

## Where your files go

| What                                  | Where                                                  |
| ------------------------------------- | ------------------------------------------------------ |
| ROMs                                  | The emulator's `<roms>/<system>/`, or `~/rommix/roms/` |
| Saves and states                      | The emulator's own save folders                        |
| BIOS files                            | The emulator's own BIOS folder                         |
| Settings, credentials, download index | `~/rommix/config/`                                     |
| Emulators RomMix installed            | `~/rommix/emulators/`                                  |
| Log file                              | `~/rommix/logs/rommix.log`                             |

By default ROMs go into each emulator's own library, so a game is still there
when you start that emulator yourself — RetroDECK's is wherever you told
RetroDECK to put it, SD card included. Settings → **Games on disk** switches
that to one RomMix folder instead.

---

## Troubleshooting

Settings → **Pre-flight check** names the common problems, and **Re-run check**
re-tests after you fix one.

**RomMix does not start, or the Steam shortcut does nothing.** Run it from a
terminal — an AppImage that cannot start says why there and nowhere else. If it
starts from a terminal but not from Steam, look in
`~/.local/share/Steam/logs/console-linux.txt`.

**`Cannot mount AppImage`, `mount failed: Operation not permitted`, or `No
suitable fusermount binary found`.** Steam launches games in a way that stops an
AppImage mounting itself; no `PATH` or `FUSERMOUNT_PROG` value changes that. Use
`rommix-steam.sh` from the release — see [From Steam](#from-steam).

**`error while loading shared libraries: libnspr4.so`** (or `libglib-2.0.so.0`).
The distribution does not ship the libraries an unpatched binary expects. On
NixOS it needs answering twice, since Steam runs games in its own FHS
environment where `programs.nix-ld` does not apply:

```nix
# Appended, because assigning this option replaces nixpkgs' own default set.
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

Also on NixOS: leave `programs.appimage.binfmt` off, and an AppImage emulator
needs `programs.nix-ld.enable` too.

**"flatpak is not installed".** Most of the emulators are flatpaks, so without
the command none can be found or installed. Install it and re-run the check.

**"Flathub is not set up for your user".** RomMix adds the remote the first time
you install an emulator; by hand:

```bash
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

**"… has not been run yet, so its folders do not exist".** Press **Run** beside
it in Settings → Emulators, let it start, then re-run the check.

**"The ROM folder is not writable".** Check its permissions, and that the drive
it is on is mounted.

**"No installed emulator can run …".** Nothing installed covers that platform —
Settings → Platforms shows what each resolves to.

**"RomMix does not know which folder … maps to".** Add a `systemOverrides` entry.

**A game shows as not downloaded although the file is there.** Its platform is
pointed at a different emulator now, and the file is in the previous one's
library. Point it back, or download a copy for the new one.

**The game starts but RomMix keeps focus, and Steam does not list its window.**
Something is launching the emulator outside the tree Steam started. Add the
AppImage to Steam directly, or a script that `exec`s it.

**The controller does nothing.** Press a button on it and check the pre-flight
check: Chromium hides pads until one is used. A pad listed as `(unmapped)` is
one Chromium does not recognise; the buttons RomMix uses still work, and any
that do not are worth reporting with that name.

**The interface is tiny on a 4K television.** Settings → Interface → **Scale**;
set 200% by hand if Auto did not.

### The log

`~/rommix/logs/rommix.log` holds everything RomMix does — the command each
emulator was started with, what was asked of RomM, where every file was written.
Credentials are stripped on the way in, so it is safe to paste into a bug report.

```bash
tail -f ~/rommix/logs/rommix.log
```

It rolls over at 5 MB. `ROMMIX_LOG=debug` adds every request and probe;
`ROMMIX_LOG=off` writes nothing.

---

## Development

```bash
npm install
npx install-electron   # Electron 43 no longer fetches its binary on install
npm run dev            # against a live RomM server
npm run preview:app    # the front end alone, in a browser, on :5273
npm run preview:web    # the whole public site, built and served, on :5274
npm run format:check
npm run lint
npm run typecheck
npm test
npm run appimage       # build dist/RomMix-<arch>.AppImage
```

Those four checks are what CI runs, in that order, and what `npm run release`
refuses to cut a tag without. [CONTRIBUTING.md](CONTRIBUTING.md) covers the
layout, the house style and how to add an emulator — which, like adding a system
or a BIOS requirement, is a change in `src/config/` and nowhere else.

`npm run preview:app` runs the renderer as a web page against a stub library,
for looking at the front end where starting Electron is not worth it.
`npm run build:site` assembles it with [site/index.html](site/index.html) into
`out/site` — what [Pages](.github/workflows/pages.yml) publishes.

### Releasing

```bash
npm run release minor          # or major, patch, or an exact version
npm run release -- --dry-run   # npm eats flags that come without the --
```

[release-it](https://github.com/release-it/release-it) runs the checks, bumps the
version, writes the [CHANGELOG.md](CHANGELOG.md) entry, commits, tags and pushes;
a `v*` tag publishes a release with the AppImage attached, and a version with a
suffix — `0.2.0-rc1` — publishes as a pre-release. The entry falls back to commit
subjects, so write the `## <version>` section by hand first if you want prose.

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) — how to get set up, what CI checks, and where
each kind of change belongs.

Security reports go through
[private vulnerability reporting](https://github.com/leclercb/rommix/security/advisories/new)
rather than a public issue — see [SECURITY.md](SECURITY.md).

---

## Licence

MIT — see [LICENSE](LICENSE).

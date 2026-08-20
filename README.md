# RomMix

A Big Picture–style front end for your own [RomM](https://romm.app) server.

Browse your library like a console dashboard, download games into your emulator's
ROM folder, launch them, and sync saves and save states back to RomM when you
quit. Built for a TV or a handheld: fullscreen, driven entirely by a controller,
at home under gamescope or launched from Steam.

---

## Requirements

- **Linux**, with `flatpak`.
- **A RomM server** you can reach, version 5.x or newer, with an account on it.
- **At least one emulator.** RomMix installs these for you from Settings:

  | Emulator      | Covers                                | Installed from                       |
  | ------------- | ------------------------------------- | ------------------------------------ |
  | **RetroDECK** | Most systems, from the NES to the PS3 | Flathub                              |
  | **RetroArch** | Everything with a libretro core       | Flathub                              |
  | **Eden**      | Nintendo Switch                       | Its own release page, as an AppImage |

  Start with RetroDECK if you have none of them: it covers the most platforms and
  picks the right emulator for each system itself. [EmuDeck](#emudeck) works too,
  but run its own installer first — RomMix does not install it.

- **A controller** is recommended but not required.

---

## Install

Download `rommix-<version>-x86_64.flatpak` from
[Releases](https://github.com/leclercb/rommix/releases):

```bash
flatpak remote-add --user --if-not-exists \
  flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./rommix-<version>-x86_64.flatpak
```

Or build it yourself, which needs Node 20.19+ or 22.12+, `flatpak` and
`flatpak-builder`:

```bash
git clone https://github.com/leclercb/rommix.git
cd rommix
npm install
./scripts/build-flatpak.sh
```

There is no Flathub package yet.

### Run it

```bash
flatpak run be.bl_it.RomMix                    # desktop
gamescope -f -- flatpak run be.bl_it.RomMix    # gamescope session
```

**From Steam:** add `flatpak run be.bl_it.RomMix` as a non-Steam game. RomMix
starts fullscreen and is fully navigable with a controller, so Big Picture needs
no extra setup.

### Permissions

The build already asks for everything RomMix needs. If you tighten them later
with Flatseal, these are the ones that matter:

| Permission                            | Why                                                   |
| ------------------------------------- | ----------------------------------------------------- |
| `--talk-name=org.freedesktop.Flatpak` | Starting an emulator. Without it nothing will launch. |
| `--filesystem=home`                   | Reading and writing ROMs, saves and BIOS files.       |
| `--filesystem=/run/media`             | A ROM library on an SD card or external drive.        |
| `--device=all`                        | Controller input. Without it the UI is keyboard-only. |

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

### Emulators

What RomMix found, what each one covers and where it keeps its games. Buttons
install RetroDECK or RetroArch from Flathub, download Eden, or **Run** an
emulator on its own — needed for the setup only the emulator can do: RetroDECK
creates its folders on first run, RetroArch needs its cores, Eden needs its keys.

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
- **Ask before sending saves to RomM** — off by default. Lists the files first
  and sends only what you approve; what you decline stays on this device.

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

**"flatpak-spawn cannot reach the host"**
RomMix cannot start an emulator. Grant `--talk-name=org.freedesktop.Flatpak` in
Flatseal.

**"… has not been run yet, so its folders do not exist"**
Press **Run** beside it in Settings → Emulators, let it start, then re-run the
check.

**"The ROM folder is not writable"**
Grant RomMix access to wherever your ROMs live. Home and `/run/media` are already
allowed; anywhere else needs adding in Flatseal.

**"No installed emulator can run …"**
Nothing here covers that platform. Settings → Platforms shows what each one
resolves to; Settings → Emulators shows what is installed.

**"RomMix does not know which folder … maps to"**
Add a `systemOverrides` entry, as above.

**A game shows as not downloaded even though the file is there**
Its platform is pointed at a different emulator now, and the file is in the
previous one's library. Point it back, or download a copy for the new one.

**An AppImage emulator will not start on NixOS**
AppImages need `programs.nix-ld.enable`, and must _not_ go through
`appimage-run` (`programs.appimage.binfmt = false`).

---

## Development

```bash
npm install
npx install-electron   # Electron 43 no longer fetches its binary on install
npm run dev            # against a live RomM server on your desktop
npm run typecheck
npm test
npm run flatpak        # build and install the flatpak
```

Instead of `npx install-electron` you can point `ELECTRON_EXEC_PATH` at a system
Electron, which is what `.envrc` does here. Packaging is unaffected either way.

`src/config/` holds the platform table, the RomM slug mapping, the emulator
registry, the BIOS requirements and the ROM-format tables. **Adding a system, a
BIOS requirement or an emulator is a change in `src/config/` and nowhere else** —
no file outside it names an emulator.

### Releasing

```bash
npm run release minor          # or major, patch, or an exact version
npm run release -- --dry-run   # npm eats flags that come without the --
```

[release-it](https://github.com/release-it/release-it) runs the checks, bumps the
version, writes the metainfo changelog entry, commits, tags and pushes.
[.github/workflows/flatpak.yml](.github/workflows/flatpak.yml) builds the flatpak
on every push and, for a `v*` tag, publishes a release with the bundle attached.
A version with a suffix — `0.2.0-rc1` — publishes as a pre-release.

The changelog entry the hook writes falls back to commit subjects, so for a real
release commit a hand-written `<release>` entry in
`flatpak/be.bl_it.RomMix.metainfo.xml` first and its prose will be left alone.
Its `date` is stamped at release time either way, so whatever you write there
does not matter.

> **On Flathub.** The manifest packages a prebuilt application tree, which
> Flathub does not accept — submitting would mean vendoring the npm sources with
> [`flatpak-node-generator`](https://github.com/flatpak/flatpak-builder-tools)
> and building with `npm ci --offline`.

---

## Licence

MIT — see [LICENSE](LICENSE).

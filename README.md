# RomMix

A Big Picture–style front end for your own [RomM](https://romm.app) server.

RomMix browses your RomM library like a console dashboard, downloads games into
your emulator's ROM folder, launches them, and syncs your save files and save
states back to RomM when you quit.

It is built for a TV or a handheld: fullscreen, driven entirely by a controller,
and happy under gamescope or launched from Steam.

---

## Requirements

- **Linux**, with `flatpak` installed.
- **A RomM server** you can reach, version 5.x or newer, with an account on it.
- **At least one emulator.** RomMix can install these for you from its Settings
  screen:

  | Emulator | Covers | Installed from |
  | --- | --- | --- |
  | **RetroDECK** | Most systems, from the NES to the PS3 | Flathub |
  | **RetroArch** | Everything with a libretro core | Flathub |
  | **Eden** | Nintendo Switch | Its own release page, as an AppImage |

  RetroDECK is the one to start with: it covers the most platforms and picks the
  right emulator for each system itself. You do not need all three.

- **A controller** is recommended but not required — keyboard and mouse work.

---

## Installing

There is no published Flathub package yet, so RomMix is built from source. It is
one command, and needs Node 20+, `flatpak` and `flatpak-builder`.

```bash
git clone <this repository>
cd rommix
npm install
./scripts/build-flatpak.sh
```

The script installs the flatpak runtimes it needs, builds the app, and installs
it for your user. When it finishes:

```bash
flatpak run be.bl_it.RomMix
```

### Permissions

The build already asks for everything RomMix needs. If you tighten permissions
later with Flatseal, these are the ones that matter:

| Permission | Why |
| --- | --- |
| `--talk-name=org.freedesktop.Flatpak` | Starting an emulator. Without it nothing will launch. |
| `--filesystem=home` | Reading and writing ROMs, saves and BIOS files. |
| `--filesystem=/run/media` | A ROM library on an SD card or external drive. |
| `--device=all` | Controller input. Without it the UI is keyboard-only. |

---

## Running it

```bash
flatpak run be.bl_it.RomMix                      # desktop
gamescope -f -- flatpak run be.bl_it.RomMix      # gamescope session
```

**From Steam:** add `flatpak run be.bl_it.RomMix` as a non-Steam game. RomMix
starts fullscreen and is fully navigable with the controller, so Big Picture
needs no extra setup.

---

## Connecting to RomM

On first launch RomMix asks for your server address and how you want to sign in.
There are three ways, in the order that suits a controller:

1. **Pair this device** *(recommended on a TV)* — RomMix shows a short code and a
   QR code. Scan it with your phone, or open the address in any browser, and
   approve the request from RomM. Nothing secret is typed on the couch.
2. **API token** — a long-lived `rmm_…` token created in RomM under
   *Administration → Client tokens*.
3. **Username and password** — signs in and stays signed in.

Your credentials are stored in RomMix's own folder, encrypted with the system
keyring. Where no keyring is reachable — which happens inside a flatpak without a
portal — they fall back to a file readable only by you.

---

## Controls

| Button | Action |
| --- | --- |
| Left stick / D-pad | Navigate |
| A | Select |
| B | Back |
| X / Start | Open Settings |
| Y | Search |
| LB / RB | Previous / next tab, on a game's page |

Keyboard: arrow keys, Enter, Escape or Backspace to go back, Tab and Shift-Tab
for tabs, `/` to search, `m` for Settings.

---

## Using it

**Home** shows the game you last played, the games already on this device, your
favourites and recent additions.

**Library** is everything on your server, searchable and filterable by platform.
A dot on a cover means the game is already downloaded.

**Open a game** to download it, play it, look at what RomM holds for it, or
remove it. Downloads run one at a time and continue while you keep browsing.

**Downloads** shows the queue and everything currently on this device, grouped by
platform. **Sync with disk** checks your whole library against the folders on
this machine: it forgets games you deleted by hand and adopts ROMs you copied in
yourself, so you are never asked to download something you already have.

**BIOS** shows, per platform, which BIOS files are needed, which of them your
RomM server holds, and whether the emulator already has them — then copies the
missing ones into place. BIOS files come from your own server and nowhere else:
upload them to RomM under a platform, and RomMix installs them for you. Some
platforms (Switch, PS3, Vita, 3DS, Wii U) need a dump from a real console rather
than a file, and say so instead of listing files that will never appear.

---

## Configuration

Everything is in **Settings**.

### Emulators

Shows what RomMix found on this machine, what each one covers, and where it keeps
its games. Buttons here install RetroDECK or RetroArch from Flathub, download a
build of Eden, or **Run** an emulator on its own — which is how you do the setup
only the emulator itself can do: RetroDECK does not create its folders until it
has been run once, RetroArch needs its cores, and Eden needs its keys.

### Platforms

One row per platform in your library, showing which emulator runs it. Press the
button to cycle through the emulators that can run that platform. Left alone,
each platform uses a sensible default.

A choice you make is honoured strictly: if you pin a platform to an emulator and
that emulator is missing, RomMix tells you so rather than quietly using another
one. Platforms you have not chosen for fall back to whatever is installed.

Note that each emulator keeps its games in its own folder. Pointing a platform at
a different emulator does not move anything, so RomMix will offer those games for
download again — nothing is deleted, and pointing it back brings them straight
back.

### Save sync

- **Download newer saves before playing** — a save from another device is fetched
  before the game starts. It only ever replaces a local save that is *older*, and
  the local file is kept as `*.rommix-bak` first.
- **Upload saves after playing** — only the files the session actually wrote are
  sent back to RomM.

You can also pull or push a single game's saves by hand from its page.

How much of this works depends on the emulator. A save named after the ROM (the
libretro `.srm`) syncs cleanly. Emulators that key saves by title id instead —
Eden — or that share one memory card between every game cannot have a save
attributed to a single game, so RomMix skips them and says why rather than
uploading the wrong data.

### Downloads

- **Ask before deleting a downloaded game** — on by default, since Uninstall is a
  focused button one press away from removing a multi-gigabyte file.

### RomMix folder

Everything RomMix owns lives in one folder, `~/rommix` by default: your settings,
your RomM credentials, the index of downloaded games, and any emulator RomMix
installed for you. Moving this one folder moves the whole installation — set a
new path here and RomMix copies your configuration across and restarts. Your ROMs
and emulators stay where they are.

You can also point `ROMMIX_HOME` at a folder, which wins over anything set here.

### Settings that are not on screen

Two rarely-needed options live in `~/rommix/config/settings.json`, inside the
`"settings"` object. Close RomMix before editing it.

- **`systemOverrides`** — for a platform RomMix has no folder for. Maps a RomM
  platform slug to an ES-DE system folder name:

  ```json
  "systemOverrides": { "sega-pico": "segapico" }
  ```

- **`emulatorPaths`** — for an emulator kept somewhere RomMix would not look.
  Maps an emulator id to the executable:

  ```json
  "emulatorPaths": { "eden": "/mnt/games/Eden.AppImage" }
  ```

---

## Where your files go

| What | Where |
| --- | --- |
| ROMs | The ROM folder of the emulator that runs the platform, under `<roms>/<system>/` |
| Saves and states | The emulator's own save folders |
| BIOS files | The emulator's own BIOS folder |
| Settings, credentials, download index | `~/rommix/config/` |
| Emulators RomMix installed | `~/rommix/emulators/` |

ROMs go into each emulator's own library rather than a folder of RomMix's own, so
a game is still there when you start that emulator on its own and ES-DE scrapes
it as usual. RetroDECK's library is wherever you told RetroDECK to put it,
including an SD card — RomMix reads that from RetroDECK's own configuration
rather than assuming.

A single-file game is installed as a file, even when RomM zipped it for transfer.
A genuine multi-file game — cue+bin, or a multi-disc set — is unpacked into a
folder of its own, and RomMix works out which file to hand the emulator: the
`.m3u` or `.cue` rather than the much larger `.bin` it points at.

---

## Troubleshooting

Settings → **Pre-flight check** names the common problems explicitly, and
**Re-run check** re-tests after you fix one.

**"flatpak-spawn cannot reach the host"**
RomMix cannot start an emulator. Grant it `--talk-name=org.freedesktop.Flatpak`
in Flatseal.

**"… has not been run yet, so its folders do not exist"**
RetroDECK creates its folders on first run. Press **Run** beside it in Settings →
Emulators, let it start, then re-run the check.

**"The ROM folder is not writable"**
Grant RomMix access to wherever your ROMs live. Home and `/run/media` are already
allowed; an unusual location needs adding in Flatseal.

**"No installed emulator can run …"**
Nothing on this machine covers that platform. Settings → Platforms shows what
each one resolves to, and Settings → Emulators shows what is installed.

**"RomMix does not know which folder … maps to"**
RomMix has no ES-DE folder for that platform and will not guess, because
installing to the wrong folder fails silently later. Add a `systemOverrides`
entry as described above.

**A game shows as not downloaded even though the file is there**
Its platform is probably pointed at a different emulator now, and the file is in
the previous emulator's library. Point it back, or press Download to fetch a copy
for the new one — the original is left alone.

**An AppImage emulator will not start on NixOS**
AppImages need a loader for the binaries inside (`programs.nix-ld.enable`), and
must *not* be routed through `appimage-run` (`programs.appimage.binfmt = false`),
which only understands older AppImages.

---

## Building and development

```bash
npm install
npm run dev         # run against a live RomM server on your desktop
npm run typecheck   # tsc over main, preload and renderer
npm test            # platform, emulator and launch-file tests
npm run flatpak     # build and install the flatpak
```

`src/config/` holds the parts most worth editing: the platform table, the RomM
platform-slug mapping, the emulator registry and the BIOS requirements. It is
plain data plus a few lookups, with tests, and adding a platform or an emulator
should not need a change anywhere else.

> **On Flathub.** The manifest packages a prebuilt application tree, which is
> fine for a personal build but not accepted by Flathub, which requires a fully
> offline build. Submitting would mean vendoring the npm sources with
> [`flatpak-node-generator`](https://github.com/flatpak/flatpak-builder-tools)
> and building with `npm ci --offline`.

---

## Licence

MIT.

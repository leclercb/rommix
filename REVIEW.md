# Still to do

What a full-codebase review on 2026-09-20 turned up and left standing. Everything
else it found was fixed in the commit that added this file; what is here is only
the work that remains, with the reason each was not done at the time.

## Left open

- [ ] **`src/config/emulators/libretro.ts` — the core ids RetroDECK and EmuDeck read
      off disk are missing from `CORE_LIBRARY_NAMES`.** `coreForCommand` captures a
      name like `mednafen_pce_libretro.so` off the frontend's own configuration, and
      a core absent from the table falls back to the unsorted directory — which is
      deliberate and safe, so what this costs is only that a _pull_ does not create
      the sorted folder a core reads from when "sort saves by core name" is on. Not
      filled in because each value has to be the core's real `library_name`, and the
      module's own doc is explicit that a guessed folder is worse than a missing one:
      a miss falls back, a wrong entry writes the save where the core will never
      look. EmuDeck's display labels are not a source — they disagree with this
      table's existing values (`VICE xVIC` against `VICE xvic`). Needs the names read
      off a real RetroArch. Missing today: `kronos`, `mednafen_saturn`,
      `mednafen_lynx`, `melondsds`, `mame2003_plus`, `mesen-s`, `easyrpg`, `np2kai`,
      `vice_xplus4`, `px68k`, `same_cdi`.

- [ ] **Save-table rows no launcher reaches** — `retrodeck/saves.ts` (`primehack`,
      `triforce`, `tanodragon`) and `emudeck/saves.ts` (`vita3k.sh`, `Vita3K`,
      `primehack`, `suyu`). Reported as dead code, but they read as prepared rather
      than dead: `emuDeckSaveFolder` falls back to the script's own name, so each row
      wires itself up the moment an `EMUDECK_LAUNCHERS` entry exists. Deleting them
      removes correct knowledge; adding the launchers asserts that EmuDeck ships
      those emulators under script names nothing here has verified. `primehack` in
      `retrodeck/saves.ts` is the one clear exception, not being an ES-DE system at
      all, so nothing can ever key on it. The hazard actually worth closing is the
      reverse one, and it is silent: the lookup is a bare `Record` falling back to
      `standard(root)`, so a launcher added without a `FOLDERS` entry resolves to
      `perRom(<root>/saves)` and uploads one game's shared card under another game's
      id. That wants the binding test below rather than a deletion.

- [ ] **`src/main/safepath.ts:26` — containment is lexical only.** A directory
      symlink already inside a system folder, routine on EmuDeck, plus a RomM
      `file_name` of `disc/.bashrc` passes `safeJoin` and is written through. The gap
      that mattered is closed — the save pull now goes through `safeJoin` like every
      other reader of a server-supplied name — but hardening the function itself
      means a `realpath` comparison, which makes it async across twelve call sites
      and rewrites a test file that is pure string cases throughout. Worth its own
      commit and its own review.

- [ ] **`src/config/emulators/types.ts` — `SaveLocation`, `LayoutSource` and the
      `dirs`/`layout` pair are not discriminated unions**, so the types admit
      descriptors that are nonsense: `{ match: 'shared', archive: true }` syncs a
      shared memory card as a per-game archive, `section` is silently ignored for
      `format: 'shell'`, and `LaunchVariant.requires` is honoured only for a
      `scripts` install, so a `requires` on a flatpak is always-offered. The
      `shared`/`directory`/`perRom` helpers are the only thing enforcing any of it
      today, and `registry.test.ts` iterates `EMULATORS`, so `example/index.ts` is
      unchecked. A real improvement to the central interface, and a refactor of it
      rather than a defect in it.

- [ ] **`src/shared/types/romm.ts:17,20,74,75` and `Credentials.expiresAt`.**
      `token_type`, `refresh_expires`, `oauth_scopes` and `avatar_path` have no
      reader, and being non-optional they force `test/app/server.ts` and
      `dev/bridge.ts` to invent values; `expiresAt` is written three ways and never
      read, the client refreshing reactively on a 401, so `Date.parse` there can only
      ever persist `NaN`. `oauth_scopes` is the one worth keeping rather than
      deleting — it is what would let sign-in check the token it was handed against
      `REQUIRED_SCOPES` and say so, instead of meeting the first 403 at the call site.

## Verify before fixing

None of these can be settled by reading, and each changes a finding's severity.

- [ ] **Does `flatpak run` return early for an app that already has an instance?** If
      it does, `run()`'s `close` fires within `STARTUP_MS` and a launch is reported
      failed while the emulator is still up and holding its save files open — worse
      than anything the review found.
- [ ] **Is shadPS4's user directory `shadPS4` or `shadps4` on disk?**
      `ls ~/.local/share | grep -i shadps4`, or under
      `~/.var/app/net.shadps4.shadPS4/data/`. `shadps4/index.ts:56` declares
      `shadps4/savedata`; save resolution survives either way through a
      case-insensitive rescan, but the pre-flight panel prints the declared path,
      which on a case-sensitive filesystem may not exist.
- [ ] **Is IGDB's Fairchild Channel F slug `fairchild-channel-f`?** One
      `GET /api/platforms` against a server holding that platform settles it.
      `systems.ts:229` claims `channel-f` while the row's own `icon` says the longer
      form; if the row is wrong the platform surfaces as unmapped and `freechaf` is
      never reached.
- [ ] **Is RomM's favourites collection spelled British?** `setFavourite` depends on
      the name and RomM derives `is_favorite` from it. Neither `schema/` nor the fake
      can settle it, both encoding the same reading. If it is not, every star press
      creates another collection.
- [ ] **Under the `arcade` theme, does a shelf become its own vertical scroller?**
      `rows.css:5-15` notes that `.row`'s `overflow-y: visible` computes to `auto`
      beside `overflow-x: auto`, and `scroll.ts:313` treats `auto` as a scroller. If a
      shelf's content exceeds its `clientHeight` by a pixel — that theme sets
      `--type-scale: 1.24` against a fixed `padding-bottom` — `scrollParentsOf`
      returns the shelf as the vertical scroller and the page stops scrolling as focus
      walks down. `npm run test:app` under that theme is where to settle it.

## Tests worth adding

- [ ] That the byte-carrying calls go out with no deadline attached. The fix is in —
      `transport` passes `timeoutMs: null` — but nothing fails if it is undone, and
      undone it makes firmware uninstallable on a slow link.
- [ ] That a complete `.part` finishes the download instead of re-requesting it, and
      that `unpack` cannot promote a file left by an earlier attempt. Both are plain
      filesystem assertions that need no screen.
- [ ] That the variant a launch runs is the variant `saves()` is resolved from:
      `LaunchOptions.effective` against the id `game:launch` passes on. This is the
      rule behind the worst finding in the review and nothing pins it.
- [ ] That every `FOLDERS` / `SAVE_FOLDER_BY_SCRIPT` / `SWITCH_FOLDERS` key is
      produced by some launcher, and that every launcher's folder has an entry. The
      second direction is the one that is silently wrong today.

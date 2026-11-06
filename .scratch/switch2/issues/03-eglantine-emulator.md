# 03: Eglantine emulator — detection, launch, setup notes

**What to build:** Eglantine (`Djihads80/Eglantine`, an Eden fork) becomes an emulator RomMix knows, under id `eglantine`, running only `switch2` — Eden stays the only Switch 1 emulator. It is detection-only: found as a program named `eglantine` on the PATH, an `eglantine*.AppImage`, or wherever `emulatorPaths` points; RomMix offers no download, since every Eglantine release is a prerelease whose tags are deleted and recreated. A Switch 2 game launches with `-f -g <rom>`. Its folders follow XDG under its own name — saves under `eglantine/nand/user/save`, no states, no BIOS directory — and games come from RomMix's own ROM folder, put flat, which the user adds in Eglantine (as for Eden). Saves are declared through the Switch save layout, which cannot yet read a `.nup`'s title id, so nothing is synced and nothing wrong is sent until ticket 04.

Setup notes, in the order they are met, translated into every catalogue: add RomMix's ROM folder in Eglantine; launch Eglantine once by hand to answer its migration dialog (it blocks the first start when an Eden install exists, and RomMix would wait on it); map the controller in Eglantine; turn off confirm-on-exit — **verify in Eglantine's source that it still has one, and drop this note if not**. RomMix writes nothing into Eglantine's configuration.

Hand-maintained lists follow the code: README emulator table, site texts and table, bug-report emulator dropdown.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Registry tests: launch argv, declines `switch`, detection names, no release source
- [ ] An Eglantine pinned via `emulatorPaths` is detected and offered for `switch2` only
- [ ] Setup notes exist in every language catalogue; typecheck enforces completeness
- [ ] README, site and issue template list Eglantine
- [ ] No code outside the config layer names Eglantine
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` pass

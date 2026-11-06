# 02: Nintendo Switch 2 system

**What to build:** RomMix recognises RomM's `switch-2` platform as a system of its own, `switch2` (ADR 0001), labelled "Nintendo Switch 2", badge `NSW2`, using RomM's `switch-2` platform icon. A Switch 2 game installs into its own `switch2` folder. A Switch 2 game is a single `.nup` container, which is the only file ever launched — never the playlist RomM offers for a multi-file game. Until an emulator declares the system, RomMix says plainly that no installed emulator can run the Nintendo Switch 2, as it does for any system without one. The system needs no BIOS step: `.nup` content is not encrypted. Its title id prefix is `04`, declared the way ticket 01 makes possible once that lands (if 01 has not landed, leave the prefix to ticket 04).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Slug `switch-2` resolves to system `switch2`; `switch` still resolves to `switch` only
- [x] The system row passes the platform-table invariants (icon present, short label length)
- [x] On `switch2` the `.nup` is chosen as the launch file over an `.m3u` listing it
- [x] No BIOS entry exists for `switch2`
- [x] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` pass

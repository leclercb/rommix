# RomMix

A desktop client for a self-hosted RomM server: it installs games from RomM's
library onto the machine and launches them in local emulators.

## Language

**Platform**:
A console as RomM catalogues it, identified by a platform slug.
_Avoid_: System (when RomM's side is meant)

**Platform slug**:
RomM's own identifier for a platform, read from the server, e.g. `switch-2`.
It is neither ES-DE's name nor a folder name.
_Avoid_: fs_slug, folder name

**System**:
A console as RomMix knows it: a row of the platform table, named after ES-DE's
system directory, and what emulators declare they can run. One system may
answer to several platform slugs; two consoles that need different emulators
are always two systems.
_Avoid_: Platform (when RomMix's side is meant), console

**Title id**:
The 16-hex-digit identifier a Nintendo console gives a game, and what its save
folder is named after. Its leading digits are fixed per system — `01` on the
Switch, `04` on the Switch 2 — so the same digits never mean a game on both.
_Avoid_: Program id, game id

**Emulator**:
A program RomMix knows by name: how to find it, how to launch a game in it and
where it keeps its saves. Only an emulator RomMix knows can run a system.
_Avoid_: Core, launcher, custom emulator

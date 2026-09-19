# TODO

Things worth doing that are not being done yet, with whatever has already been
worked out about each — so that picking one up does not mean starting from
nothing. An entry here is a decision that has been thought about and deferred,
not a wish.

## Named checkpoints beside the synced save

Two features hide under one word. RomM's `slot` is the pairing key: the copy
sent under `AUTOSAVE_SLOT` is the one Grout, RomM's own player and RomMix on
another device read back, so a slot somebody types over that one ends the
interop while still looking like it worked. The sync slot stays where it is.

The other is what Grout actually offers and what is worth having: a copy set
aside on purpose — before a boss, before a trade — kept off to one side and
come back to later.

Nothing about the wire format has to change for it. RomM takes any slot name —
the field is a free string with no enum, pattern or length in any document under
`schema/` — pairing is exact equality on the ROM and the name, and RomMix
already reads every slot a game has and gives each one a row on the Saves tab.
The listing side is done.

What is missing is the two ends of it, and neither is a setting:

- Sending one is a button on the Saves tab that puts the primary save up under a
  name. The name comes pre-filled and typing it is opt-in — a text field is the
  expensive control on a pad, and a checkpoint nobody can be bothered to name is
  a checkpoint nobody makes. `AUTOSAVE_SLOT` itself has to be refused, or the
  checkpoint walks into the pairing.
- Bringing one back is a button on the row that carries the slot, beside the
  delete already there: the copy goes over the file the emulator opens, through
  the same `keepBackup` copy-aside a pull does, behind a confirmation that names
  what it displaces.

That answers what a pull does once somebody has chosen, which is what this entry
deferred: nothing. `toPull` goes on leaving every slot but the shared one alone,
because restoring is a press rather than something a launch infers — which is
also why there is no per-game choice to remember anywhere.

Two things to carry into it. `RommState` has no slot in RomM's schema, so this
is battery saves only; for states the emulator's own numbered slots already do
the job. And `RommClient.uploadSave` turns on the server's own cleanup whenever
a slot is passed — one copy per name leaves it nothing to rotate, but that is
worth sending deliberately rather than inheriting.

Not part of what issue #12 asked for, which was that a game played here and on a
phone stay one save. That is what the shared slot does, and this is a second
feature wearing the same mechanism.

## A copy of the whole library on this disk

Argosy's model: walk the entire RomM library on first connection, keep it
locally, and bring it up to date on start and from a button. Weighed against
what RomMix does — ask the server for each page, search and count — and not
taken. Written down so that the question does not have to be measured again.

What the server offers makes it cheap to keep current. Every version under
`schema/` has `updated_after` on `GET /api/roms`, so a pass after the first
brings down only what changed, and `GET /api/roms/identifiers`, which lists
every ROM id in one answer and is how a game deleted on the server would be
noticed. `Library.sync` already walks the whole library for the disk check and
throws away what it read — the first pass would be that walk, kept.

Measured on 2026-09-19 against a RomM 5.2.0 holding 5,099 ROMs on 21 platforms,
read-only:

- The full walk took about thirty seconds: seventy megabytes of JSON, nine on
  the wire, since RomM compresses and `fetch` asks it to. Most of that is not
  the game: `merged_ra_metadata` is three fifths of every record and
  `igdb_metadata` a further sixth, and `/api/roms` has no way to leave them out.
  Kept without those two, the library is eighteen megabytes on disk and about
  sixty in memory — fine at this size, not at ten times it.
- A pass with nothing changed answered in about 150 ms; the identifiers list in
  about a second and a half.
- A live search answered in about 140 ms, which is the number that matters most.
  Searching the kept copy took a few milliseconds, and the difference is not
  something anybody waits on over a LAN.
- Playing a game does not move the ROM's `updated_at` — a game last played the
  day after the newest `updated_at` in the library showed it. What `rom_user`
  carries (last played, status, and most likely favourites) would need a refresh
  of its own, and the Home screen's "Continue playing" would stay a live query
  whatever else moved.

Why not, then. A game that is not downloaded cannot be downloaded without the
server either, so browsing the whole library offline buys nothing —
`OfflineCache` already covers the games that can actually be played. What is
left is fewer requests and faster counts, and neither is felt: the search is
debounced, the per-platform counts ask for one row each, and both are quick. Set
against that, a second source of truth that goes stale, a local search that does
not match RomM's own, per-user fields that have to be fetched separately anyway,
and a memory cost that grows with the library.

Nor would the copy ever be whole. Achievements, favourites, statuses and what
was last played change on the server at any moment, from any device. They
belong to the player rather than to the ROM — last played, at least, does not
move `updated_at` — so a library read from this disk is out of date in exactly
the parts that are about the player. Leaner records would not change
that, and RomM has no way to ask for them anyway: `/api/roms` selects no fields,
and `SimpleRomSchema` carries `merged_ra_metadata` like the rest.

Nor does a slow network turn it around — a handheld on public wifi or a
phone's connection. A page of search results is a few hundred kilobytes on the
wire rather than the megabyte and more it is as JSON, and the covers the grid
fetches for it weigh more than the page does. A copy of the library leaves
every one of those covers to fetch, so it would speed up searching there and
little else, and away from home it is the downloaded games that get played.

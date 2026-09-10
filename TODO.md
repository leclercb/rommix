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

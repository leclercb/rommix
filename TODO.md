# TODO

Things worth doing that are not being done yet, with whatever has already been
worked out about each — so that picking one up does not mean starting from
nothing. An entry here is a decision that has been thought about and deferred,
not a wish.

## A save slot the user picks, per game

Saves go up under one slot, `AUTOSAVE_SLOT`, which is what makes them pair with
the other clients. Grout lets a person name slots besides that one and choose
between them per game, and the useful thing it buys is not sync but a
checkpoint: a copy set aside before a boss, kept off to one side, come back to
on purpose.

Nothing about the wire format has to change for it. RomM takes any slot name —
the field is a free string with no enum, pattern or length in any document under
`schema/` — and pairing is exact equality on the ROM and the name. RomMix
already reads every slot a game has and shows the ones that are not the shared
one on the Saves tab, so the listing side is done. What is missing is a control
to set one, somewhere to remember it per ROM, and the four catalogue entries any
new phrase costs.

The part that needs deciding first is what a pull does once a person has chosen.
Today a slot that is not the shared one is listed and deliberately left alone —
see `toPull` — because nothing on this device answers to it and the only place
its copy could be written is over the save currently being played. A picker is
exactly the person saying to do that, so choosing a slot has to become an
action with the weight of one, rather than a setting that quietly changes what
the next launch overwrites.

Not part of what issue #12 asked for, which was that a game played here and on a
phone stay one save. That is what the shared slot does, and a picker is a second
feature wearing the same mechanism.

## Which slot the other clients actually write

`AUTOSAVE_SLOT` is the name RomM's own schema points clients at — twice, in the
`ClientSaveState` field and in the docstring for `/api/sync/negotiate`, both
committed under `schema/` — and Grout's guide says its saves go there by
default. That is the whole of the evidence. Argosy and Tender describe their
save sync without naming a slot anywhere a reader can reach, and issue #12 named
Argosy in particular, so the one client the fix was asked for is the one the
convention is unconfirmed against.

Nothing to build, and nothing a fake can settle: a slot name is a convention
between programs rather than anything RomM validates, so the only answer is what
another client really writes. One save synced from Argosy against a server
somebody already runs, then `GET /api/saves?rom_id=` — the `slot` on the row is
the answer. If it turns out to be some other name, what changes is one constant.

Worth doing before anyone concludes from a quiet Saves tab that syncing is
broken, since a mismatch looks exactly like nothing happening.

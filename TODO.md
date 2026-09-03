# TODO

Things worth doing that are not being done yet, with whatever has already been
worked out about each — so that picking one up does not mean starting from
nothing. An entry here is a decision that has been thought about and deferred,
not a wish.

## A game of several files fetched as one archive

The per-file path is covered. What is not is the fallback for a server too old
to have that endpoint, which builds an archive per request: it is not the same
size twice and has nothing to seek into. `checksumOf` returning null and
`supportsRange` answering false for a multi-file ROM are RomMix's answers to
that, and they can be driven from a fake told to behave the same way.

What no fake settles is whether RomM really does behave so — which is worth
establishing once, by hand, against a server somebody already runs, and writing
into the fake. Not worth standing a server up in CI for: that is one container
set per version in `schema/`, a scan to wait on, and a nightly that goes red for
reasons that are not RomMix.

## The pad while an emulator owns the screen

Every press but Start held down is dropped, which is what stops A in a game from
quitting the game through the running overlay's autofocused Close button. It
needs a game actually running to mean anything, and sequencing it inside a
launch made the scenario about timing rather than about input.

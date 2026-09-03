# TODO

Things worth doing that are not being done yet, with whatever has already been
worked out about each — so that picking one up does not mean starting from
nothing. An entry here is a decision that has been thought about and deferred,
not a wish.

## Scenarios not yet written

`test/app/scenarios.test.ts` covers starting up, moving around, downloading a
game, a game of several files, pausing one and picking it up again,
uninstalling one, launching one, a save round trip either side of that session,
installing the BIOS a platform needs, the collections, settings and emulators
screens, the tab strips and the two buttons that are not on the D-pad, driving
it with a pointer instead, scrolling a page taller than the screen, and the
server going away underneath all of it. What is left:

- **A game of several files fetched as one archive.** The per-file path is
  covered — those are ordinary files on RomM's disk and the fake serves them
  faithfully. What is not is the fallback for a server too old to have that
  endpoint, which builds an archive per request: it is not the same size twice
  and has nothing to seek into. `checksumOf` returning null and `supportsRange`
  answering false for a multi-file ROM are RomMix's answers to that, and they
  can be driven from a fake told to behave the same way. What no fake settles is
  whether RomM really does behave so — which is worth establishing once, by hand,
  against a server somebody already runs, and writing into the fake. Not worth
  standing a server up in CI for: that is one container set per version in
  `schema/`, a scan to wait on, and a nightly that goes red for reasons that are
  not RomMix.

# TODO

Things worth doing that are not being done yet, with whatever has already been
worked out about each — so that picking one up does not mean starting from
nothing. An entry here is a decision that has been thought about and deferred,
not a wish.

## A real RomM to test against, on a slower cadence

`npm run test:app` drives the built application against a fake RomM in
`test/app/server.ts`, and `npm test` holds `src/shared/types/romm.ts` to the
`/openapi.json` of every version in `schema/`. Between them they cover what
RomMix does with an answer, and whether the answer's shape is one RomM really
sends. Neither covers what RomM actually _serves_.

The gap is narrow and specific, and it is the most delicate thing RomMix does:
a game of several files, where the archive is built per request and is not the
same size twice. `RommClient.fileTransfers`, `supportsRange` and
`checksumOf` returning null for a multi-file ROM all exist because of what a
real server does there, and a fake can only ever agree with them. Firmware
content and a save round-trip are the other two worth a real server.

What it costs: two containers, a database health check with a start period
measured in tens of seconds, a library volume, and a scan to wait on before the
API returns anything; metadata providers have to be switched off or the run
reaches third parties. Seeding is scriptable rather than needing the database
directly: `/api/users/register` for the first user, `/api/token` for a token,
`/api/tasks/run/{task_name}` and `/api/tasks/status` to scan.

That start period is the whole argument for the cadence. It is fine nightly and
intolerable on every pull request, which is why the fake belongs in the gate and
this does not. Nothing about the scenarios has to change either way: `startApp`
takes a base URL and does not care what is answering it — which is what makes
this an afternoon of CI wiring rather than a second suite.

## Scenarios not yet written

`test/app/scenarios.test.ts` covers starting up, moving around, downloading a
game, a game of several files, pausing one and picking it up again,
uninstalling one, launching one, a save round trip either side of that session,
installing the BIOS a platform needs, and the server going away underneath all
of it. What is left:

- **A game of several files fetched as one archive.** The per-file path is
  covered — those are ordinary files on RomM's disk and the fake serves them
  faithfully. What is not is the fallback for a server too old to have that
  endpoint, which builds an archive per request: it is not the same size twice
  and has nothing to seek into, so no fake can stand in for it. That one needs
  the real server above.

# TODO

Things worth doing that are not being done yet, with whatever has already been
worked out about each — so that picking one up does not mean starting from
nothing. An entry here is a decision that has been thought about and deferred,
not a wish.

## Catching up after a spell offline

Playing away from RomM works; coming back does not finish the job.

What the server says about a game is written down when it is installed — the
whole `RommRom` and its artwork, see
[`src/main/offline.ts`](src/main/offline.ts) — and every screen narrows to what
is on the disk whenever the server stops answering. Two things are held back
while that lasts, and nothing hands them on afterwards.

- **Saves written offline.** A session away from the network writes its saves
  normally and the push fails; the launcher reports it and that is the end of
  it. Nothing records that this device holds a save RomM has not seen, so the
  next launch that _can_ reach the server does not send it either — the push
  only ever looks at what the session just wrote. What is wanted is a note of
  the game and the moment, drained on reconnect, and an answer for the case
  where RomM's copy moved on in the meantime.
- **Downloads queued offline.** A transfer started with nothing to talk to
  pauses, keeps its bytes and stays in the queue, which is right; it simply
  waits for somebody to press Resume. `ConnectionWatch` already announces the
  moment the server comes back, so the missing part is the decision about
  whether draining the queue then is help or a surprise on a metered link.

Neither is a matter of what is known — the index and the queue both survive a
restart already. Both are questions about what RomMix should do without being
asked.

## Integration tests that drive the real application

`npm test` covers the main process a module at a time and deliberately leaves
out the renderer, the IPC wiring and anything that spawns a process. Nothing
covers those together, which is where a channel renamed in `src/main/ipc/` and
not in `src/preload/`, a screen that throws on the way in, or a focus engine
that has stopped moving would live.

A working version of this was built and then removed, pending a decision on
which server it should run against. What it established:

- The app can be driven from outside with no automation library. It is already
  an Electron process; started with `--remote-debugging-port`, the DevTools
  protocol over a WebSocket is enough to evaluate in the page and dispatch real
  key events. Key presses must be sent as `rawKeyDown` — a `keyDown` carries a
  character and never reaches the page's own handler.
- The seams needed already exist as ordinary configuration: `ROMMIX_HOME` for a
  throwaway state folder, `emulatorPaths` for pointing an emulator at a shell
  script that stands in for one, and the `RAW1` credentials format for seeding a
  signed-in session without driving the sign-in screen.
- The highlight is read from `[data-focused="true"]`, which `useFocusable`
  already sets — not from `document.activeElement`, which stays on the body.
- A stand-in emulator has to outlive `Launcher`'s startup grace, or it is
  correctly treated as a launch that failed rather than a session that happened.
- Driving the interface wants a few stable handles: which screen is showing,
  where a menu item leads, and what a button is regardless of its label, which
  changes with the language and with the state of the game.
- It bites. Renaming an IPC channel on one side only failed the tests that
  depend on it and left the rest passing.

The open question is what answers the HTTP:

- **A fake server in the repository.** Fast, offline, deterministic, and what
  the removed version used. It tests RomMix's own wiring, which is what breaks
  week to week. Its weakness is that it encodes beliefs about RomM's API rather
  than checking them.
- **A real RomM under Docker.** The only thing that can answer what the server
  actually serves — in particular for a game of several files, where the archive
  is built per request. Costs two containers, a database health check with a
  start period measured in tens of seconds, a library volume, and a scan to wait
  on before the API returns anything; metadata providers have to be switched off
  or the run reaches third parties. Seeding is scriptable rather than needing
  the database directly: `/api/users/register` for the first user, `/api/token`
  for a token, `/api/tasks/run/{task_name}` and `/api/tasks/status` to scan.
- **A schema contract check.** Commit RomM's `openapi.json` for the version
  RomMix targets and assert that every field `src/shared/types.ts` declares
  exists in it with a compatible type. Seconds, no Docker, and it catches drift
  in both directions. It is not a substitute for either of the above, but it is
  the cheapest answer to the fake's actual weakness.

These are not exclusive: the fast one belongs on every pull request and the
faithful one on a slower cadence, and a test script that takes a base URL does
not care which is answering it.

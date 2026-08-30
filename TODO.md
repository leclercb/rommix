# TODO

Things worth doing that are not being done yet, with whatever has already been
worked out about each — so that picking one up does not mean starting from
nothing. An entry here is a decision that has been thought about and deferred,
not a wish.

## Play without the server

Launching a game that is already on this device needs RomM to be reachable.
`game:launch` in [`src/main/ipc/game.ts`](src/main/ipc/game.ts) fetches the ROM
from the server before it does anything, and every shelf on the home screen is a
query. So a handheld away from the network — the arm64 case RomMix is built for
— cannot start a game sitting on its own disk.

What makes this tractable is that the index already holds most of the answer:
`InstalledRom` carries the name, the cover, the system, the platform's display
name and the file list, because the Downloads screen never fetches the library.
The gap is the rest of `RommRom`, which the launcher and save sync want.

Two shapes, neither tried:

- keep the whole `RommRom` beside the index entry at install time, and read it
  when the server cannot be reached;
- or synthesise one from `InstalledRom` on a failed fetch, which is less data to
  store and more places to be wrong.

Whatever is downloaded while offline is a queue to drain later, and the saves
written are a push that has to wait — so this is also a question about what
RomMix does when it comes back, not only about what it does while away.

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

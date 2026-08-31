# Changelog

Newest first. `npm run release` adds the entry for a version, falling back to the
commit subjects since the previous tag — so write the section by hand before
releasing if you want prose instead. See [Releasing](README.md#releasing).

## 0.9.0-rc.1 — 2026-08-31

- Report play time in a shape RomM will accept
- Mark a running game as now playing on RomM

## 0.9.0-rc.0 — 2026-08-31

- Offer release candidates to whoever asks for them
- Close the emulator through its process group, not its pid
- Cover the ways an emulator is closed and a game is removed
- Make forcing an emulator closed do something, and say that it did
- Record what a game is made of instead of storing it twice
- Lift the footer's fade above the hints instead of across them
- Stop naming one file of a game the uninstall will delete
- Say what the download button actually did
- Check an archived game against RomM's hash after unpacking it
- Fix the download queue's order, and split it into three sections
- Add the year icon to the home banner's chip
- Read RomM's release date as milliseconds
- Let the waiting transfer overtake the one on the wire
- Update to Electron 44 and refresh the dependencies
- Test the empty-HOME fallback without the machine's XDG variables
- Leave the working install alone when a new one is refused
- Cover the installs a plain name does not describe
- Drop unused translations
- Say what preferring on-screen candidates actually does
- Keep the RomM client's own types to itself
- Name the two directory walks for what they return
- Say why a download stopped when there is a reason to give
- Keep a name the server chose inside the folder it is for
- Read a state file that is not what RomMix wrote as an empty one
- Ask the example descriptor and the language state the same questions
- Ask for Node 24
- Rebuild a shelf's query once per query, not once per page
- Split the game screen's logic out of its markup
- Separate the transfer queue from the library it writes into
- Read the desktop's directories from one place
- Test the folder-shaped save against a folder-shaped save
- Keep the installed emulator until its replacement has arrived
- Check what RomMix installs against the digest it was published with
- Raise the coverage floors to what the suite now reaches
- Cover the zip writer's trees, links and refusals
- Ask every EmuDeck launcher and every RetroDECK component
- Cover save sync's failure paths and what a push preview claims
- Cover the RomM client's probes, listings and asset endpoints
- Test the half of host.ts that runs another program
- Test the emulator probe against a described machine
- Correct what EmuDeck's descriptor says about an unknown launcher
- Say what really happens when RomM refuses a status
- Name a listing's key for what it is
- Remove the blank lines a deleted phrase left in the catalogues
- Stop the installed event carrying an argument nothing reads
- Put seven doc comments back on what they describe
- Describe what verifying does to each of the two files it takes
- Check a BIOS only where RomM has a hash to check it against
- Say when a download was refused for its hash
- Put a promoted download in front of everything that is waiting
- Drop folder readings once they have gone stale
- Clear a stopped transfer's intent even when it finished anyway
- Let an update's commit message carry a body
- Draw real console icons in the demo
- Stop telling the player how save syncing works
- Add a full-screen launch screen
- Let a waiting download start now
- Say how far through a game you are
- Forget the folder readings when a transfer is thrown away
- Add a TODO list
- Check what arrived against the hash RomM holds
- Read a system folder once per page rather than once per game
- Keep download progress off the screens that do not show it
- Measure only what is on the screen when focus moves
- Write and announce adopted games as a batch

## 0.8.1 — 2026-08-29

- Give the tabs and the page's links their icons
- Show screenshots and badges in the README
- Stop the pairing countdown restarting when the screen redraws
- Say when an action is not available in the demo
- Centre the landing page's arrows and stop them scrolling the page

## 0.8.0 — 2026-08-28

- Stop the log rotation tests from flooding the console
- Save the landing page's screenshots as WebP instead of PNG
- Show real screenshots on the landing page
- Log rotation and retention
- Put the changelog on the release page
- Let downloads be paused and resumed
- Fix clicks on buttons inside a focusable row
- Pick a broken ROM download up where it stopped

## 0.7.8 — 2026-08-28

- Run the checks before every commit
- Name the next queued update after each commit
- Shorten the release page's instructions
- Cover the main process with unit tests
- Expand/collapse game description
- Add navigation sounds
- Add a downloaded-only filter to the library
- Make remote tag more readable in game files tab
- Add screenshot viewer in game details page
- Show the size of local game files

## 0.7.7 — 2026-08-27

- Stop back walking through every screen you have visited
- Make force close reach the emulator, not just its wrapper

## 0.7.6 — 2026-08-27

- Give the home page's featured game a backdrop
- Land on the tile below when moving between shelves
- Stop the push dialog warning about a save RomM already matches
- Stop a save reading as newer on RomM right after you push it

## 0.7.5 — 2026-08-26

- Add screenshots
- Update webpage and readme
- Write down the project's comment conventions for Claude
- Check for new versions sooner after starting

## 0.7.4 — 2026-08-25

- Compare save tags against the emulator id, not the frontend id

## 0.7.3 — 2026-08-25

- Fix EmuDeck detection, its Run button, and re-pairing on every start
- Offer only the EmuDeck launchers that are actually installed

## 0.7.2 — 2026-08-25

- Add a language dropdown with flags and a GitHub star count to the site header
- Fix the demo crashing on load

## 0.7.1 — 2026-08-25

- Put the save push buttons on one row
- Show a game's files as one list tagged by where each one is

## 0.7.0 — 2026-08-25

- Offer to force an emulator closed when it ignores the request to quit
- Add flags to the language setting and an icon to the launch variant buttons
- Show the favourites button as an icon only
- Report BIOS and save-preview failures instead of showing an empty result
- Add a Collections page and assign games to collections from the game details page
- Add controller setup to Eden's notes
- Show an emulator's setup steps as soon as it is installed
- Show the running overlay for an emulator started on its own
- Tell Eden users to turn off its exit confirmation
- Move emulators out of Settings onto a page of their own
- Explain what moving the ROM library costs before it moves
- Default new installations to the shared RomMix ROM folder
- Internationalization

## 0.6.0 — 2026-08-24

- Auto update, split settings page into tabs

## 0.5.1 — 2026-08-24

- Update webpage and readme
- Add "do not ask again" button in save confirmation dialog, refactor code and split big files
- Details tab columns cap
- Split delete save buttons, fix saves shown as "newer here"

## 0.5.0 — 2026-08-23

- Code audit, improve tests and documentation

## 0.4.2 — 2026-08-23

- Add collection write scope to romm, fix rom file to run, allow exit from shortcuts

## 0.4.1 — 2026-08-23

- Add steam launcher script
- Update troubleshooting area of readme

## 0.4.0 — 2026-08-23

- Fix appimage creation in workflow
- Migrate from flatpak to appimage, add changelog
- Improve website, remove host env vars, add preview:web and preview:app

## 0.3.0 — 2026-08-23

- Fix host env leak, improve navigation, add setup wizard, rom storage choice, support link
- Improve website, fix retrodeck launcher

## 0.2.0 — 2026-08-22

- Use romm demo library
- Logs all events into a file
- Update workflows
- Add website and demo, fix size on 4k screen, start eden in fullscreen, fix gamepad
- Improve layout and menu, add web preview
- Improve about tab in game details, add favourite button, fix start/close emulator
- Refactor libretro, improve launcher, close emulator fix, improve saved files list
- Add license

## 0.1.0 — 2026-08-20

First release.

# Changelog

Newest first. `npm run release` adds the entry for a version, falling back to the
commit subjects since the previous tag — so write the section by hand before
releasing if you want prose instead. See [Releasing](README.md#releasing).

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

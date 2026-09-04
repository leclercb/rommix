# Changelog

Newest first. `npm run release` adds the entry for a version, falling back to the
commit subjects and ids since the previous tag — so write the section by hand
before releasing if you want prose instead. See [Releasing](README.md#releasing).

## 0.12.0 — 2026-09-04

- feat: show the version RomMix is running in the footer (29df809)
- test(unit): cover a Switch save folder being copied aside by a pull (965beef)
- feat: keep the last three copies of a save a pull overwrites (5b78266)

## 0.11.0 — 2026-09-04

- test(app): stop the walk to a button looping between two controls (6f02be6)
- fix: stop a resting pointer taking the highlight when the page moves (95a4b5f)
- fix: hide the buttons that cannot stop a download any more (eef8b81)
- fix: say what a download is doing after the last byte (c87bf06)
- feat: draw a progress bar while an emulator build downloads (6838dbe)
- feat: create the ROM folder when Eden or shadPS4 is installed (9bb947f)
- feat: show progress while BIOS files download (6ceda45)
- fix: stop SteamOS doubling every character typed into a field (2fbdc1c)
- fix: stop the menu running over the brand and the server line (be02b9d)
- fix: keep focus out of the page behind a modal that has no buttons (c23ad0e)
- fix: update the platform counts when a filter changes (259acea)
- docs: update the feature list (8499c21)
- refactor(i18n): draw the language flags instead of typing them (e651b2f)
- feat(site): download the newest AppImage from the home page (2778d8b)
- test(app): uninstall a game from the list it is in (039f7b1)
- test(app): refuse a push, then tell it to stop asking (2dd21ff)
- test(app): bring a state down as well as a save (e79eaf6)
- test(app): clear the transfers that have finished (142c302)

## 0.10.0 — 2026-09-04

- test(app): read the interface in another language (2ace921)
- test(app): hand a platform to another emulator (a882dbe)
- test(app): install one BIOS file, and look at the disk again (0439108)
- test(app): answer the question that moves the library (8e9ae25)
- test(app): sign in the other two ways, and from a fresh install (2da4beb)
- test(app): tell two icon buttons apart while walking to one (a1a9d9b)
- test(app): choose which runner plays a system (5ae631e)
- test(app): move saves by hand, and a state with them (06a1c04)
- test(app): drive a transfer from the row it is drawn on (8e47d25)
- test(app): sign out again at the end of pairing (150749c)
- test(app): press the heart on a game (c462872)
- test(app): press the two buttons on the downloads screen (0bac618)
- test(app): wait for a deleted save to go before reading the disk (e733c4c)
- test(app): look at the screenshots of a game (161bbc1)
- test(app): say how far through a game you are (671ff57)
- test(app): put a game on a shelf and take it off again (ffe2db7)
- test(app): delete a save from the server as well as this disk (18f86a8)
- docs: drop the TODO, which only described unsupported servers (3d86e47)
- feat: put an icon beside every page and dialog title (06a6630)
- test(app): cover going offline and coming back (0dbf75a)
- test(app): serve cover art from the fake RomM (19c79b6)
- chore: name release commits with the new convention (12ac6fe)
- test(app): cover the pad while an emulator owns the screen (b7be3e0)
- docs: adopt type(scope) prefixes on commit subjects (013ca0c)
- test(app): close an emulator refusing to quit (51f2c55)
- test(app): cover grouping the downloads screen by system (7a6e4c4)
- test(app): cover deleting a save from one end only (9e4f62b)
- test(app): cover signing in by pairing (bd6997a)
- test(app): type into the library's search box (27b3273)
- test(app): cover the library's scope and platform filters (8a0abca)
- refactor(test): split the app scenarios by whether their order matters (600e7b8)
- test(app): drive it with a mapped and an unmapped controller (c4f7ba1)
- test(schema): check the bodies RomMix sends against RomM's own schema (3f9e589)
- test(app): cover the shelves RomM derives (e068c29)
- test(app): cover the pointer and the page scrolling under it (17d5074)
- test(app): reach the tab strips and the two buttons that are not directions (b90529f)
- ci: run the app suite before a release (ec5a543)
- test(unit): pin the arithmetic behind every directional press (821d5ee)
- test(app): cover the collections, settings and emulators screens (7319741)
- test(app): leave a screenshot behind wherever an app test gives up (a13667f)
- test(app): cover a download paused and picked up again (8764b25)
- test(app): cover uninstalling a game and its folder (a4b71ba)
- test(app): ask the emulator what it found rather than the screen (1734184)
- fix: keep walking the library when RomM sends no count (09d2177)
- test(app): cover a BIOS reaching the folder an emulator reads it from (4a7f63d)
- ci: give Electron a usable sandbox helper (f57edac)
- feat: record what a disc set is made of when it arrives file by file (2981ac7)
- test(app): cover a save going down before a session and back up after (67c68ad)
- test(app): drive a launch and the server going away (425d729)
- test(schema): check the types against RomM 5.0.0 as well (8f46558)
- ci: fetch Electron before the app tests (438ed04)
- test(app): drive the built app against a fake RomM (411e2f8)
- test(schema): check the types against RomM's own schema (2d34b59)
- refactor: split the biggest files along the seams they already had (fa08f04)
- test(unit): cover the decisions the offline work makes (ad1d0f7)
- feat: say in the log when the server comes and goes (8172211)
- feat: pick the download queue up again when RomM comes back (f9996f1)
- feat: send saves left unsent when RomM comes back (f26263e)
- feat: add an offline mode (a106119)

## 0.9.0 — 2026-09-01

- Fold a version's release candidates into its finished section (6189dd7)
- Insert a finished version above its candidates, not over them (9e19fe4)
- Warn on a delete only when there is no other copy to come back from (26413f7)
- Show a push and the Saves tab the same way (4f23f59)
- Ask which end to delete a save from in the dialog, not the row (38df6d4)
- Let the date format be chosen, and default to day first (0a8f6c8)
- Name the device a save came from (5b5980c)
- Say where a save came from only where it changes what to do (937dbd8)
- Order the Saves tab by the instant each save changed (0555fb6)
- Give every dialog the width the rule already promised (fcd24aa)
- Leave saves RomM already has out of the push confirmation (21e3738)
- Tighten what RomMix will write, open and navigate to (4605e0f)
- Add the commit id to the changelog subjects (8550a3d)
- Report play time in a shape RomM will accept (baa1f70)
- Mark a running game as now playing on RomM (f83959a)
- Offer release candidates to whoever asks for them (3e1e57e)
- Close the emulator through its process group, not its pid (61ddfca)
- Cover the ways an emulator is closed and a game is removed (2968961)
- Make forcing an emulator closed do something, and say that it did (63da0d3)
- Record what a game is made of instead of storing it twice (065c685)
- Lift the footer's fade above the hints instead of across them (3bb65d0)
- Stop naming one file of a game the uninstall will delete (743b1fe)
- Say what the download button actually did (d45359a)
- Check an archived game against RomM's hash after unpacking it (efb26be)
- Fix the download queue's order, and split it into three sections (c9dea57)
- Add the year icon to the home banner's chip (1c03fd8)
- Read RomM's release date as milliseconds (1bb2b6e)
- Let the waiting transfer overtake the one on the wire (5b1514e)
- Update to Electron 44 and refresh the dependencies (f7aaeba)
- Test the empty-HOME fallback without the machine's XDG variables (71fbb9f)
- Leave the working install alone when a new one is refused (8d9d335)
- Cover the installs a plain name does not describe (e0401dc)
- Drop unused translations (479d2c8)
- Say what preferring on-screen candidates actually does (bf545a8)
- Keep the RomM client's own types to itself (e058c1b)
- Name the two directory walks for what they return (f4e3135)
- Say why a download stopped when there is a reason to give (8edf0c8)
- Keep a name the server chose inside the folder it is for (9c114b7)
- Read a state file that is not what RomMix wrote as an empty one (42bab4a)
- Ask the example descriptor and the language state the same questions (423168c)
- Ask for Node 24 (0b06f8e)
- Rebuild a shelf's query once per query, not once per page (fee40fd)
- Split the game screen's logic out of its markup (858e858)
- Separate the transfer queue from the library it writes into (c6a3ec7)
- Read the desktop's directories from one place (fee18fb)
- Test the folder-shaped save against a folder-shaped save (8f254e4)
- Keep the installed emulator until its replacement has arrived (59763ba)
- Check what RomMix installs against the digest it was published with (4cc97f9)
- Raise the coverage floors to what the suite now reaches (746fde0)
- Cover the zip writer's trees, links and refusals (01a2a95)
- Ask every EmuDeck launcher and every RetroDECK component (d7584f2)
- Cover save sync's failure paths and what a push preview claims (4d785d6)
- Cover the RomM client's probes, listings and asset endpoints (4bd1b68)
- Test the half of host.ts that runs another program (0aea3ae)
- Test the emulator probe against a described machine (0b80714)
- Correct what EmuDeck's descriptor says about an unknown launcher (55fcb4e)
- Say what really happens when RomM refuses a status (4047363)
- Name a listing's key for what it is (ef8d1ed)
- Remove the blank lines a deleted phrase left in the catalogues (59cb909)
- Stop the installed event carrying an argument nothing reads (9c45fc3)
- Put seven doc comments back on what they describe (67c5115)
- Describe what verifying does to each of the two files it takes (81a1f9a)
- Check a BIOS only where RomM has a hash to check it against (eba1969)
- Say when a download was refused for its hash (9501694)
- Put a promoted download in front of everything that is waiting (5b97146)
- Drop folder readings once they have gone stale (1b5e0c3)
- Clear a stopped transfer's intent even when it finished anyway (017e657)
- Let an update's commit message carry a body (9dd09c1)
- Draw real console icons in the demo (5a475df)
- Stop telling the player how save syncing works (0461f35)
- Add a full-screen launch screen (e2f5c88)
- Let a waiting download start now (c229340)
- Say how far through a game you are (e33c3b0)
- Forget the folder readings when a transfer is thrown away (96a5744)
- Add a TODO list (2e68131)
- Check what arrived against the hash RomM holds (de04257)
- Read a system folder once per page rather than once per game (a62f8e6)
- Keep download progress off the screens that do not show it (ea2d3b7)
- Measure only what is on the screen when focus moves (8da50ef)
- Write and announce adopted games as a batch (f4bc3a0)

## 0.8.1 — 2026-08-29

- Give the tabs and the page's links their icons (1762288)
- Show screenshots and badges in the README (84814bb)
- Stop the pairing countdown restarting when the screen redraws (58a353c)
- Say when an action is not available in the demo (e334b04)
- Centre the landing page's arrows and stop them scrolling the page (75c437e)

## 0.8.0 — 2026-08-28

- Stop the log rotation tests from flooding the console (fb31de7)
- Save the landing page's screenshots as WebP instead of PNG (3aa67af)
- Show real screenshots on the landing page (aa3eeeb)
- Log rotation and retention (84435ff)
- Put the changelog on the release page (0dc57fc)
- Let downloads be paused and resumed (5ab92e9)
- Fix clicks on buttons inside a focusable row (9007b2a)
- Pick a broken ROM download up where it stopped (59e97f1)

## 0.7.8 — 2026-08-28

- Run the checks before every commit (4149fca)
- Name the next queued update after each commit (425a7e3)
- Shorten the release page's instructions (45a70f6)
- Cover the main process with unit tests (3849ff8)
- Expand/collapse game description (a1d0817)
- Add navigation sounds (5b28cfa)
- Add a downloaded-only filter to the library (29e613a)
- Make remote tag more readable in game files tab (2f7c2ca)
- Add screenshot viewer in game details page (9d74349)
- Show the size of local game files (57b3071)

## 0.7.7 — 2026-08-27

- Stop back walking through every screen you have visited (03e17c5)
- Make force close reach the emulator, not just its wrapper (0c29983)

## 0.7.6 — 2026-08-27

- Give the home page's featured game a backdrop (39de651)
- Land on the tile below when moving between shelves (ad77507)
- Stop the push dialog warning about a save RomM already matches (1700556)
- Stop a save reading as newer on RomM right after you push it (edae0b9)

## 0.7.5 — 2026-08-26

- Add screenshots (25ebf34)
- Update webpage and readme (ccecf47)
- Write down the project's comment conventions for Claude (a5560da)
- Check for new versions sooner after starting (bd0ab50)

## 0.7.4 — 2026-08-25

- Compare save tags against the emulator id, not the frontend id (24ed392)

## 0.7.3 — 2026-08-25

- Fix EmuDeck detection, its Run button, and re-pairing on every start (466fcc7)
- Offer only the EmuDeck launchers that are actually installed (8dc23df)

## 0.7.2 — 2026-08-25

- Add a language dropdown with flags and a GitHub star count to the site header (76fde39)
- Fix the demo crashing on load (1822555)

## 0.7.1 — 2026-08-25

- Put the save push buttons on one row (6fe1ee1)
- Show a game's files as one list tagged by where each one is (3d87771)

## 0.7.0 — 2026-08-25

- Offer to force an emulator closed when it ignores the request to quit (3304642)
- Add flags to the language setting and an icon to the launch variant buttons (2487b16)
- Show the favourites button as an icon only (a47d343)
- Report BIOS and save-preview failures instead of showing an empty result (4a0ab3f)
- Add a Collections page and assign games to collections from the game details page (5902483)
- Add controller setup to Eden's notes (aa52897)
- Show an emulator's setup steps as soon as it is installed (48b191b)
- Show the running overlay for an emulator started on its own (1413082)
- Tell Eden users to turn off its exit confirmation (e2fd53b)
- Move emulators out of Settings onto a page of their own (3c98c52)
- Explain what moving the ROM library costs before it moves (0e792f9)
- Default new installations to the shared RomMix ROM folder (9379597)
- Internationalization (55708ec)

## 0.6.0 — 2026-08-24

- Auto update, split settings page into tabs (482b5d9)

## 0.5.1 — 2026-08-24

- Update webpage and readme (ae26b50)
- Add "do not ask again" button in save confirmation dialog, refactor code and split big files (fc09f34)
- Details tab columns cap (0720599)
- Split delete save buttons, fix saves shown as "newer here" (315113a)

## 0.5.0 — 2026-08-23

- Code audit, improve tests and documentation (aa3fc59)

## 0.4.2 — 2026-08-23

- Add collection write scope to romm, fix rom file to run, allow exit from shortcuts (6b0d797)

## 0.4.1 — 2026-08-23

- Add steam launcher script (eef2246)
- Update troubleshooting area of readme (f1727d7)

## 0.4.0 — 2026-08-23

- Fix appimage creation in workflow (2301edd)
- Migrate from flatpak to appimage, add changelog (163b999)
- Improve website, remove host env vars, add preview:web and preview:app (7c383c0)

## 0.3.0 — 2026-08-23

- Fix host env leak, improve navigation, add setup wizard, rom storage choice, support link (6830c03)
- Improve website, fix retrodeck launcher (cc83116)

## 0.2.0 — 2026-08-22

- Use romm demo library (a0280f6)
- Logs all events into a file (9ac1ad8)
- Update workflows (d391969)
- Add website and demo, fix size on 4k screen, start eden in fullscreen, fix gamepad (4b33bc0)
- Improve layout and menu, add web preview (52d4f60)
- Improve about tab in game details, add favourite button, fix start/close emulator (3fec8bd)
- Refactor libretro, improve launcher, close emulator fix, improve saved files list (1e63993)
- Add license (0434f9d)

## 0.1.0 — 2026-08-20

First release.

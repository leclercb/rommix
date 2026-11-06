# 01: Title id prefix is a property of the system

**What to build:** A prefactor with no visible change for Switch users. The leading digits a title id must start with stop being hardcoded as `01` and become something the system declares, so the Switch keeps `01` and a later system can declare its own. Every place that recognises a title id — reading it from a container's content-metadata entry, from a file name or a playlist entry, and spotting an update or DLC by its id — asks the system for its prefix instead of assuming one. A title id carrying another system's prefix is never accepted: a save written under it would land in another game's folder.

See `GLOSSARY.md` (**Title id**, **System**) and ADR 0001.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The Switch's title id prefix (`01`) is declared once, by the system, and every title id match reads it from there
- [ ] Existing Switch save-path and launch-file tests pass unchanged
- [ ] A new test shows an id beginning `04` is not taken as a Switch title id — from a file name, from a `.cnmt` entry, or as an add-on marker
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` pass

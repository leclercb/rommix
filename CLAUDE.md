# RomMix

House style lives in [CONTRIBUTING.md](CONTRIBUTING.md) — read the "Where things
live" and "House style" sections before changing anything. Notes that go beyond
it:

## Comments

Comments explain **why**, and they explain the durable reason. Two things stay
out of them:

- **Values that can change** — a duration, a limit, a threshold, a version. The
  constant is the source of truth; repeating it in prose only leaves a lie
  behind the next time it is tuned. Say that there is a delay and why there is
  one, not how long it is. When another file needs to point at the behaviour,
  cross-reference the symbol (`see Updater.schedule`), never its current value.
- **The change being made** — a comment describes how the code stands, not what
  it used to do or what this edit is for. That is what the commit message is.

The same goes for the README where it describes tunable behaviour.

## Before proposing a change

`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` — the
four CI runs, in that order.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

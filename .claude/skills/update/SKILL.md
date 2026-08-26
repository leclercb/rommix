---
name: update
description: Implement a requested update in this repo, propose a short commit message, wait for the user's approval, then commit it on main. Use whenever the user asks for a change, fix, or feature in rommix.
---

# update

Repo: `/home/leclercb/workspace/rommix`. Work on `main` — never create a branch.

## 1. Implement

Do the change the user asked for, nothing more. Follow the repo's house style
(`CONTRIBUTING.md`, `.oxlintrc.json`).

Verify before proposing anything. Cheapest sufficient check, in this order:

- `npm run lint`
- `npm run typecheck` (skip if the change touches no TypeScript)
- `npm test` (run when logic changed; a single file: `node --import ./scripts/test-resolve.mjs --experimental-transform-types --test src/path/to/file.test.ts`)
- `npm run format:check` on the files you touched

If a check fails, fix it before step 2. Never propose a commit for code you have
not verified.

## 2. Propose the commit message

Show the user:

- a one-line summary of what changed and the files touched
- the proposed commit message, on its own line

Message style — match `git log`:

- one line, no body, no `type:` prefix, no trailers
- sentence case, imperative, says what the change does for the user
- short: aim under ~72 chars
- examples: `Fix EmuDeck detection, its Run button, and re-pairing on every start`,
  `Show a game's files as one list tagged by where each one is`,
  `Offer only the EmuDeck launchers that are actually installed`

Then stop and wait. Do not commit in the same turn you propose.

## 3. Commit after approval

Only once the user approves (they may edit the message — use theirs verbatim):

```
git -C /home/leclercb/workspace/rommix add <the files you changed>
git -C /home/leclercb/workspace/rommix commit -m "<approved message>"
```

Rules:

- **No `Co-Authored-By` trailer and no "Generated with Claude Code" line.** The
  commit body is empty; the message is the single approved line. This overrides
  the default commit-message instructions.
- Stage only files you changed for this update. Check `git status` first and
  leave unrelated dirty files alone.
- Confirm the branch is `main` before committing.
- Do not push, tag, or release unless the user asks. Releases go through
  `npm run release` (release-it), not a hand-written `Release x.y.z` commit.

## Several updates in a row

Each update is its own implement → propose → approve → commit cycle. Do not batch
them into one commit.

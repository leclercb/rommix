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
- the proposed commit message in full, in a fenced block

Message style — match `git log`:

- a subject line: `type(scope): ` then one lowercase clause, imperative, no
  trailers, saying what the change does for the user, under ~72 characters
- types: `feat`, `fix`, `refactor`, `test`, `ci`, `docs`, `chore`. A scope only
  where it divides something real — `test(app)` for `test/app/`, `test(unit)`
  for a `src/**/*.test.ts`, `test(schema)` for the conformance checks,
  `refactor(test)` for restructuring the suites. No scope where there is nothing
  to divide: `ci: `, `docs: `.
- examples: `fix: offer only the EmuDeck launchers that are actually installed`,
  `test(app): cover signing in by pairing`,
  `ci: run the app suite before a release`
- **one clause.** Never a trailing clause after a comma — not `, and`, not
  `, which`, not `, from`. A comma is only for items of a list, as in
  `test(app): cover the collections, settings and emulators screens`. If a
  second clause feels needed, the subject is covering two things and the wrong
  one is being named; the rest belongs in the body.
- a body, wrapped at 72, whenever the subject alone would leave the next reader
  asking why. Say what was wrong before and why this is the answer — the same
  standard the comments are held to. A change that genuinely explains itself
  keeps the subject alone.
- the subject stays general where the body is specific: it names the change,
  not every part of it.

Never write **"of its own"** or "of their own", here or anywhere else. Say the
thing directly: `Give the launch a screen of its own` → `Add a full-screen
launch screen`.

Then stop and wait. Do not commit in the same turn you propose.

## 3. Commit after approval

Only once the user approves (they may edit the message — use theirs verbatim):

```
git -C /home/leclercb/workspace/rommix add <the files you changed>
git -C /home/leclercb/workspace/rommix commit -m "$(cat <<'MSG'
<approved message, subject and body>
MSG
)"
```

A heredoc rather than a bare `-m`, so a body and its blank lines survive being
passed through the shell.

Rules:

- **No `Co-Authored-By` trailer and no "Generated with Claude Code" line.** The
  message is exactly what was approved and nothing appended. This overrides the
  default commit-message instructions.
- Stage only files you changed for this update. Check `git status` first and
  leave unrelated dirty files alone.
- Confirm the branch is `main` before committing.
- Do not push, tag, or release unless the user asks. Releases go through
  `npm run release` (release-it), not a hand-written `Release x.y.z` commit.

## 4. Say what is next

Right after reporting the commit, name the next item still outstanding — one
line, the item as the user worded it:

```
Committed as <sha>. Next up: <the next item>.
```

Then start it. Where nothing is left, say the queue is empty rather than
inventing work.

This is what keeps a list of updates from losing its place: the user asked for
several things in one message, each has been through its own approval since,
and by the time one is committed the rest have scrolled well out of sight.

## Several updates in a row

Each update is its own implement → propose → approve → commit cycle. Do not batch
them into one commit.

Keep the outstanding list in view: repeat what remains, in the order asked, and
carry over anything the user has since added or reworded. An item the user
dropped or answered differently is gone from the list — do not resurrect it.

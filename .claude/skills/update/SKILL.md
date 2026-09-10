---
name: update
description: Implement a requested update in this repo, propose a commit message, wait for the user's approval, then commit it on main. Several updates asked for at once are taken one at a time. Use whenever the user asks for a change, fix, or feature in rommix.
---

# update

Repo: `/home/leclercb/workspace/rommix`. Work on `main` — never create a branch.

## How this talks

Invoke the `caveman` skill first and stay in it: everything said to the user
while this skill is running is caveman, full level.

Its own auto-clarity rule still holds — a destructive step, a warning, or a
sequence that has to be followed in order drops back to plain prose and then
resumes. Two more things are never compressed, because neither is a message to
the user:

- **the commit message**, which is a file in the repo's own voice — see §2;
- **code, comments, and catalogue entries**, which follow `CONTRIBUTING.md` and
  `CLAUDE.md` exactly as they always did.

Never write **"of its own"** or "of their own" — in prose, in a comment, in a
commit message, anywhere. Say the thing directly: `Give the launch a screen of
its own` → `Add a full-screen launch screen`.

## 1. Implement — one point at a time

Several things asked for in one message are a queue, not a task. Take the one at
the head, and take it to a commit before the next one is started: the point of a
cycle each is that every one of them gets an answer that can be judged on its
own.

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

Write it with the `caveman-commit` skill. It decides the wording, the length,
and whether there is a body at all.

Two things it cannot know about this repo:

- **the prefix.** Types are `feat`, `fix`, `refactor`, `test`, `ci`, `docs` and
  `chore`, and no others. A scope only where it divides something real —
  `test(app)` for `test/app/`, `test(unit)` for a `src/**/*.test.ts`,
  `test(schema)` for the conformance checks, `refactor(test)` for restructuring
  the suites. No scope where there is nothing to divide: `ci: `, `docs: `.
- **one clause.** Never a trailing clause after a comma — not `, and`, not
  `, which`, not `, from`. A comma is only for items of a list, as in
  `test(app): cover the collections, settings and emulators screens`. A subject
  reaching for a second clause is covering two things and naming the wrong one;
  the rest belongs in the body.

Show the user, in this order:

1. a one-line summary of what changed and the files touched;
2. the proposed commit message in full, in a fenced block;
3. the next point still outstanding, as the user worded it — one line.

Then stop and wait. Do not commit in the same turn you propose.

The queue line goes here rather than after the commit because this is the turn
the user is reading: they asked for several things at once, each has been
through its own approval since, and by now the rest have scrolled out of sight.

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

## 4. Start the next point

Report the commit and begin the next item in the same turn:

```
Committed as <sha>. Next up: <the next item>.
```

Where nothing is left, say the queue is empty rather than inventing work.

Keep the outstanding list honest between cycles: repeat what remains, in the
order asked, and carry over anything the user has since added or reworded. An
item the user dropped or answered differently is gone from the list — do not
resurrect it.

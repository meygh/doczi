---
name: commit
description: Commit the current change as one Conventional Commit with a clear message and no AI attribution, after the project check passes. Use only when the user asks to commit.
argument-hint: "[optional scope or message hint]"
---

Commit: $ARGUMENTS

1. `git status` and `git diff --staged` (stage only the files of this logical change; never
   `git add -A` blindly; never stage secrets, `.env*` or build output).
2. Run the project check (`.doczi.json` → `check`). If it fails, stop and report.
3. Write the message:
   - `type(scope): summary` — types: feat, fix, refactor, perf, test, docs, build, ci, chore;
     imperative, lower case, no period, ≤ 72 characters;
   - body: why the change was needed and what it does, wrapped at 72; reference requirement
     or issue IDs;
   - `BREAKING CHANGE:` footer when a public contract changes;
   - no AI tool names, no assistant co-author trailers, no "generated with" lines.
4. Commit. Never push, amend published commits or rewrite history unless the user asks.
5. If the change finished a progress step, make sure its status is `done` in the same commit.

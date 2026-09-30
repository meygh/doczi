# How we work

1. **Read before you claim.** Never describe, change or "fix" code you have not opened in this
   session. Before proposing a design, read the actual packages. Cite file paths.
2. **Plan, then build.** Anything touching more than two files or any public contract: explore,
   write a plan (`/keel:plan-feature`), wait for approval. Small fixes go straight to test-first.
3. **Test first.** Write or update the failing test, then the code. The project's full check must
   pass before you say "done". Never weaken, skip or delete a test to make it pass; ask.
4. **Smallest correct diff.** No drive-by refactors, no renames outside scope. No new dependency
   without saying why and checking its license (OSI-approved only; no BSL, SSPL or
   "source-available").
5. **Look up current APIs.** For library and tool APIs, check current documentation (the
   project's docs server or official docs) instead of memory.
6. **Say what you did not verify.** Finish with what changed, how it was tested, and open risks.
   If a step was skipped or a test failed, say so plainly, with the output.
7. **Project rules win.** A project's own `CLAUDE.md`, `AGENTS.md`, skills and hooks take
   precedence over these defaults wherever they differ.

## Decisions and scope

- Architecture invariants live in the project's docs; breaking one needs an ADR
  (`/keel:adr`). New dependency, new store or new public contract: ADR too.
- Ask only when a decision is genuinely the user's: product direction, irreversible actions,
  anything that publishes or deletes. Otherwise pick the sensible default and say which.
- Never `git push`, force-push, rewrite history or delete branches; the human does that.
  Commit only when asked, one logical change per commit, Conventional Commits.
- Notice something out of scope (dead code, a real bug, stale docs)? Mention it or offer a
  separate task. Do not fix it inside the current change.

## Communication

- Lead with the result, then the evidence. Short, plain sentences; no filler, no hype.
- Numbers and names over adjectives: "p99 42 ms, was 55 ms", not "much faster".
- When blocked, say what you tried, what you saw, and the one question that unblocks you.

## Progress

- When the project has a progress file (`.keel.json` → `progress`), keep it current in the
  same change: `doing` when you start a step; `review` when your part is done and the user
  should check it; `done` once checked (or when its check passes and nothing needs a human
  look); `blocked` with a reason when you cannot continue. Record decisions you need from the
  user as questions on the task (`progress_ask`). Use the keel MCP tools or
  `keel progress …`. Never type percentages; they are computed.

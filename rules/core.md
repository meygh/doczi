# How we work

1. **Read before you claim.** Never describe, change or "fix" code you have not opened in this
   session. Before proposing a design, read the actual packages. Cite file paths.
2. **Plan, then build.** Anything touching more than two files or any public contract: explore,
   write a plan (`/doczi:plan-feature`), wait for approval. Small fixes go straight to test-first.
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
  (`/doczi:adr`). New dependency, new store or new public contract: ADR too.
- Ask only when a decision is genuinely the user's: product direction, irreversible actions,
  anything that publishes or deletes. Otherwise pick the sensible default and say which.
- Never `git push`, force-push, rewrite history or delete branches; the human does that. The
  one exception is a claim and its updates (below), which you push yourself.
  Commit only when asked, one logical change per commit, Conventional Commits.
- Notice something out of scope (dead code, a real bug, stale docs)? Mention it or offer a
  separate task. Do not fix it inside the current change.

## Communication

- Lead with the result, then the evidence. Short, plain sentences; no filler, no hype.
- Numbers and names over adjectives: "p99 42 ms, was 55 ms", not "much faster".
- When blocked, say what you tried, what you saw, and the one question that unblocks you.

## Claims

So two people or agents never build the same task, a task is claimed before any other work.

- **Where.** On the project's coordination branch: `.doczi.json` → `coordination.branch`
  (default `coordination`) on `coordination.remote` (default `origin`). It holds only claims and
  shares no files with the code. If the project has no such branch, claim the way its own rules
  say (often a status-only commit to the main branch); if they say nothing, ask once. Create the
  branch only when the user asks.
- **How.** One file per task, `claims/<plan>/<task>.md`, where `<plan>` is the plan's file name
  and `<task>` its step ID. Read the task's state in its plan, fetch the branch, and if no file
  exists, add it and push without force, in a separate worktree so your checkout is untouched.
  A refused push means someone pushed first: fetch, look again. A file that exists means the
  task is taken: stop and pick another. Never force a push there.
- **What it says.** The plan, who took it (a role and a person, never a tool or model name),
  since when, `State: taken`, `review` or `done`, and the branch and pull request once they
  exist. Keep it current; delete it to give the task up.
- **Who can read it.** Every branch of a public repository is public. There, write nothing but
  the task, the role and the branch, or point `coordination.remote` at a private repository.

## Progress

- When the project has a progress file (`.doczi.json` → `progress`), keep it current in the
  same change: `doing` when you start a step; `review` when your part is done and the user
  should check it; `done` once checked (or when its check passes and nothing needs a human
  look); `blocked` with a reason when you cannot continue. Record decisions you need from the
  user as questions on the task (`progress_ask`). Use the doczi MCP tools or
  `doczi progress …`. Never type percentages; they are computed.

## Machines

- Files a team shares use paths relative to the project root. Never write this machine's drive,
  project folder or home folder into them: a colleague's checkout is somewhere else.
- A value that belongs to one machine (a tool path, a proxy, a `safe.directory` entry, a local
  URL) goes in `.doczi.local.json`, which is never committed. Its `notes` are shown at the start
  of every session.
- Before `doczi init` on a checkout that follows a branch, run `git fetch`: a teammate may
  already have committed `.doczi.json` and the progress file.

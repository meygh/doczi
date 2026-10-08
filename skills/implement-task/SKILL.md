---
name: implement-task
description: Implement an approved plan step by step — test first, verify after each step, keep the progress file current, then run the reviewers and report.
argument-hint: "[docs/plans/<slug>.md] [step number or 'all']"
---

Implement $ARGUMENTS

Before the first step, find the project's check command: `.doczi.json` → `check`, otherwise
the README, Makefile, package.json or equivalent. Use it wherever this skill says "check".

For each step:
1. Set its progress step to `doing` (doczi MCP `progress_set_status` or
   `doczi progress set <milestone> <task> <step> doing`).
2. Re-read the files you will touch; they may have changed.
3. Write or adjust the failing test. Run it and confirm it fails for the right reason.
4. Make the smallest change that passes. Use the project's domain skills where they apply.
5. Run the step's verification command, then the check. Fix before moving on.
6. If the user asked for commits: one Conventional Commit per step (`/doczi:commit`).
7. Tick the step in the plan. Set its progress step to `review` when the user should look at
   the result (UI, behavior, anything they asked to approve), otherwise `done`. If you cannot
   finish it, set `blocked` with the reason and record the decision you need as a question on
   the task (`progress_ask`).

After the last step:
- Where reviewer agents exist, run the ones that apply: `security-reviewer` (auth, input
  parsing, secrets, user code, network calls), `perf-reviewer` (hot paths, storage access),
  `ux-reviewer` (any UI), `test-writer` for gaps. Where the environment has none, run its
  own code review tool on the diff and cover the same concerns (security, performance, UX,
  test gaps) yourself.
- Fix findings or list them as follow-ups in the plan.
- A feature with UI is not reported as done before its end-to-end test passes and it has been
  checked in a browser.
- Report: what changed, test evidence (commands and results), benchmarks if relevant, what
  you did not verify, open risks. Never push.

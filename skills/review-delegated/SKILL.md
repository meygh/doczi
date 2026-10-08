---
name: review-delegated
description: Review work a secondary agent did on a delegate/<id> branch — scope, untouched contract tests, project check, reviewer agents — and accept it or send it back.
argument-hint: "[id]"
---

Review delegated task $ARGUMENTS

1. Read `.handoff/$ARGUMENTS.md` and `.handoff/$ARGUMENTS.result.md`.
2. `git diff <base>...delegate/$ARGUMENTS --stat`, then the full diff. Read every changed file.
3. Reject at once if: files outside the allowed list changed; contract tests were edited or
   weakened (compare with the contract commit); new dependencies; secrets; AI tool names.
   Send it back if the result file has no self-review (tool used, findings fixed, findings
   left and why).
4. Run the brief's done-commands and the project check in the worktree.
5. Run the reviewer agents that apply (`security-reviewer`, `perf-reviewer`, `test-writer`
   for gaps). Where the environment has no reviewer agents, run its own code review tool on
   the diff and cover the same concerns yourself.
6. If the change touches UI: run the browser end-to-end tests for the flow (when they can only
   run in CI, say so and read that result). Open the changed screens in a browser and compare
   them with the approved design at the widths in the `ui-ux` skill, in light and dark, with
   a keyboard-only pass. Record the evidence in the verdict.
7. Verdict:
   - **Send back:** append "Review notes" with numbered, concrete fixes to the brief and tell
     the user to hand it back. At most two round trips; then take it over yourself.
   - **Accept:** fix small issues yourself, squash into one Conventional Commit on the branch,
     remove the worktree, and tell the user it is ready to merge.
8. Add one line to `.handoff/log.md`: id, verdict, round trips, what went wrong. Over time it
   shows which kinds of tasks are worth delegating.

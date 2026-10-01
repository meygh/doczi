---
name: delegate-task
description: Prepare a bounded task for a secondary agent after the user approved delegating it — isolated worktree, contract-first stubs and failing tests, and a self-contained brief in .handoff/. Use only after explicit approval in this conversation.
argument-hint: "[plan file] [step numbers]"
---

Delegate: $ARGUMENTS

0. Confirm the user approved delegating these exact steps in this conversation. If not, ask
   and stop.
1. Create an isolated workspace: `git worktree add .worktrees/<id> -b delegate/<id>` from the
   current base, where `<id>` is a short slug of the task. Make sure `.worktrees/` and
   `.handoff/` are git-ignored.
2. In that worktree, write the contract yourself: interfaces, types, signatures with
   not-implemented bodies, and failing tests that define done. Commit them on the branch
   (`test(<scope>): contract for <task>`).
3. Write `.handoff/<id>.md` with:
   - goal (two or three sentences) and requirement IDs;
   - files to read first, and the pattern file to imitate;
   - files it may change (explicit list); everything else is read-only;
   - done = these tests pass and the project check is green, with the exact commands;
   - constraints: follow `AGENTS.md`; no new dependencies; no test edits except added cases;
     no secrets; no AI tool names anywhere;
   - out of scope;
   - report: write `.handoff/<id>.result.md` (what changed, commands run, open questions).
4. Tell the user the worktree path and the one line to give the secondary agent:
   "Read .handoff/<id>.md in this repo and complete it."
5. Do not change the same files until `/doczi:review-delegated <id>` is done.

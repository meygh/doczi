# 0005. Claims on a coordination branch, before the server

- Status: Accepted (2026-10-16)
- Date: 2026-10-16
- Amends: [0004](0004-shared-progress-branch-and-claims.md) ("No claims yet")
- Requirements: none (asked for by the owner after two agents started the same task)

## Context

ADR 0004 left claims for a hosted server, because refusing a second start "needs one place that
answers at once". Meanwhile two agents started the same task in one project: the first claimed
it with a status-only commit on the main branch; the second never looked. The owner asked for
claims now, kept off the main branch, on a branch made for coordination and readable only by the
project's contributors.

A git branch already answers at once. A push without force succeeds only on top of what the
pusher last fetched, so when two people add the same claim, the second push is refused and,
after a fetch, the second person sees the first claim. That is the compare-and-swap ADR 0004
already relies on for the shared progress file.

## Options

1. **One file per task on a coordination branch in the project's repository.**
   - _Pro:_ works today with plain git; no service; a refused push is the "already taken"
     answer; access follows the repository; never merged into the code.
   - _Con:_ works only for those who follow the rule; a public repository shows the branch to
     everyone.
2. **Status commits on the main branch** (what projects did until now).
   - _Con:_ fills the main branch's history; conflicts with branch protection; a plan's state
     column is easy to miss.
3. **Wait for the hosted server** (ADR 0004).
   - _Con:_ two agents building the same task in the meantime.

## Decision

Option 1, as a rule in `rules/core.md` ("Claims") and in the skills that start work
(`implement-task`, `delegate-task`):

- `.doczi.json` may name the branch and remote: `"coordination": { "remote": "origin",
  "branch": "coordination" }`; those are the defaults.
- One file per task, `claims/<plan>/<task>.md`, pushed without force before any other work. A
  file that exists means the task is taken. It says who took it by role and person, since when,
  its state (`taken`, `review`, `done`) and its branch and pull request. Deleting it gives the
  task up.
- Where a project has no coordination branch, its own rules decide; projects so far used a
  status-only commit on the main branch.
- In a public repository the branch is public: claims there carry nothing but the task, the
  role and the branch, or `coordination.remote` points at a private repository.
- The shared progress file of ADR 0004 is meant for the same branch when it is built, so a
  project has one side branch, not two.

## Consequences

- **Positive:** a second start is refused today, with nothing to install or host; the main
  branch keeps only code and documents.
- **Negative:** the rule is followed, not enforced; an agent that skips it is not stopped. The
  hosted server (v0.4) is still the way to enforce it. Agents now push one kind of commit
  themselves, which `rules/core.md` names as the only exception.
- **Follow-ups:** `doczi claim` and `doczi release` in the CLI and MCP server, and the session
  start text naming open claims; the shared progress sync (ADR 0004) on the coordination
  branch.

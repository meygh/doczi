# 0004. A shared progress branch in each project; claims wait for the server

- Status: Accepted (2026-10-08); amended the same day, see "History of this decision"
- Date: 2026-10-08
- Requirements: none (asked for by the owner: several developers, each with several agents,
  work on the same projects and sometimes the same tasks)

## Context

The progress file lives on the code branches. That worked for one person, and fails for a team:

- Every branch has its own copy. A step set to `doing` on a feature branch is invisible to
  everyone else until that branch merges, which is when the work is already finished.
- Projects answer this by repeating statuses elsewhere: a State column in each plan document, a
  status-only commit pushed straight to the main branch. Now there are two records and they
  drift.
- A step does not say who holds it, so two people, or two agents of one person, can start the
  same step and neither is told.

The rule that shapes the options: doczi has no dependencies and no service to run. Git is
already there in every project that has more than one contributor.

## Options

1. **A shared branch in each project's own repository, holding only the progress file.** The
   project's progress file stays on the code branches; doczi syncs it with the shared branch
   through a three-way merge and a push without force.
   - _Pro:_ the same progress from every branch and machine; nothing to install or host; access
     follows the project; no project data leaves the project; the branch's log is the history.
   - _Con:_ a sync needs the network; the branch must accept direct pushes; it does not by
     itself stop two people from starting the same step.
2. **A branch per project in one hub repository.** The same mechanism, with every project's
   record in one place.
   - _Pro:_ one place shows all projects.
   - _Con:_ every contributor of every project needs push rights on the hub and can read the
     other projects; the hub grows with every status change; a second repository to protect.
3. **Status commits on the main branch.**
   - _Con:_ conflicts with branch protection and required reviews; fills the history with status
     commits; every feature branch still carries a stale copy.
4. **A hosted doczi server.**
   - _Pro:_ instant updates, access per person, and it can refuse a second start on a held step.
   - _Con:_ someone must run, secure and back it up; work stops when it is down.
5. **Do nothing.** The drift stays.

## Decision

Option 1 now. Option 4 later, with claims.

- **Everything stays in the project.** `.doczi.json` gains `"shared": { "remote": "origin",
  "branch": "shared-progress" }`. Without it, a project behaves exactly as today.
- **Two places, kept in step.** Every change is written to the project's progress file and then
  synced with the shared branch. The agent working in a project creates the branch with
  `doczi share` when it is missing; doczi's rules and skills tell it to.
- **Sync is a three-way merge** of the last synced state, the project's file and the shared
  branch, step by step. Changes to different steps are all kept. When the same step changed on
  both sides the later change wins and the sync reports it.
- **Writes to the shared branch are compare-and-swap.** The merged state is committed with git
  plumbing and pushed without force; a refused push means fetch, merge again and retry a bounded
  number of times. The project's index and current branch are never touched.
- **Work never waits for the network.** A failed sync is reported; the next one delivers the
  change.
- **The HTTP API and the three servers do not change.** They keep writing the progress file; the
  sync carries it on.
- **Statuses live only in doczi.** `doczi share` removes the statuses repeated in plan documents,
  shows what it changed and keeps longer notes on the task; `doczi check-status` reports any that
  remain.
- **No claims yet.** Refusing a second start needs one place that answers at once. That is the
  hosted server, which gets its own decision record.

## Consequences

- **Positive:**
  - the same progress from every branch, machine and tool;
  - who changed what and when, from the shared branch's log;
  - no project data outside the project;
  - no dependencies, no service, and no change to the API.
- **Negative:**
  - two people can still start the same step; they see it only after a sync;
  - git must be on the path, and a sync needs the remote;
  - the shared branch needs direct pushes and, in projects with branch naming rules, an
    exception or another name;
  - code branches carry different copies of the progress file and can conflict on merge; a sync
    restores the shared state.
- **Follow-ups:**
  - the hosted server with claims (v0.4; its own ADR);
  - a note in `docs/plans/storage.md` that the shared branch's log is the history for shared
    projects.

## History of this decision

All on 2026-10-08, by the owner:

1. Accepted as a dedicated branch per project with claims.
2. Amended to add a second copy in a hub repository, then to make the hub branch the only shared
   copy.
3. Amended to this form: the shared branch in each project only, changes stored in the project's
   documents and on that branch, and claims left for the hosted server.

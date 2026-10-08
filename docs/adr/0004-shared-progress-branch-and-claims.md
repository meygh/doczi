# 0004. One shared copy of progress on its own git branch, with claims

- Status: Accepted (2026-10-08)
- Date: 2026-10-08
- Requirements: none (asked for by the owner: several developers, each with several agents,
  work on the same projects and sometimes the same tasks)

## Context

The progress file lives on the code branches. That worked for one person, and fails for a team:

- Every branch has its own copy. A step set to `doing` on a feature branch is invisible to
  everyone else until that branch merges, which is when the work is already finished.
- A step has a status, a title and a reason. Nothing says who holds it, so two people, or two
  agents of one person, can start the same step and neither is told.
- The lock (`lib/lock.mjs`) stops two writers on one machine from losing each other's change. It
  does nothing across machines.
- Projects answer this by repeating statuses elsewhere: a State column in each plan document, a
  status-only commit pushed straight to the main branch. Now there are two records and they
  drift.

doczi has to be the one record of who is doing what, and it has to refuse a second start.

The rule that shapes the options: doczi has no dependencies and no service to run. Git is
already there in every project that has more than one contributor.

## Options

1. **A dedicated branch that holds only progress.** An orphan branch (default
   `doczi-progress`) on the project's remote. doczi reads and writes it with git plumbing, without
   checking it out. A write is a new commit pushed without force: if someone pushed first, git
   refuses, doczi fetches, applies the change again and retries. A step records who holds it.
   - _Pro:_ one copy for every branch and every machine; the refused push is the compare-and-swap,
     so two claims cannot both win; history comes free as the branch's log; nothing to install or
     host; works with any git remote.
   - _Con:_ progress changes no longer appear in a code pull request; a claim needs the network;
     the branch must accept direct pushes from contributors.
2. **Status commits on the main branch.** Keep the file where it is and push each change there.
   - _Pro:_ nothing new to learn.
   - _Con:_ conflicts with branch protection and required reviews; fills the history with status
     commits; every feature branch still carries a stale copy and merges it back.
3. **A hosted doczi server.** A service holds progress; clients call it.
   - _Pro:_ instant claims, live dashboard, access control per person.
   - _Con:_ someone must run, secure and back it up; work stops when it is down; it breaks the
     "nothing to install" promise for small teams.
4. **Do nothing.** Projects keep their own conventions, and the drift stays.

## Decision

Option 1 now. Option 3 later, as another backend behind the same store interface, for teams that
want it; the branch stays the default and keeps working without a server.

- **The branch belongs to the project, not to doczi.** Each project that uses doczi has its own
  progress branch on its own remote. doczi's rules and skills tell the agent working there to
  create it (`doczi share`) when it is missing; doczi's own repository holds no project's data.
- **An optional second copy.** A project may name a mirror: another repository and a branch
  named after the project. doczi pushes the progress there after each change and copies the
  project's management documents on sync. The project's own branch decides; the mirror is
  written only by doczi and never blocks work.
- **Storage is chosen per project.** `.doczi.json` gains `"shared": { "remote": "origin",
"branch": "doczi-progress" }`. Without it, a project behaves exactly as today (a file on the code
  branch), so single-person projects change nothing.
- **A store interface** in `lib/store.mjs` (`read`, `change`, `history`) with two backends: `file`
  (today's behaviour) and `branch`. The CLI, the MCP server and the HTTP servers call only the
  interface. A later `server` backend plugs in here.
- **Writes are compare-and-swap.** Fetch the branch, apply the change to its file, build the
  commit with plumbing (`hash-object`, `mktree`, `commit-tree`), push without force. On a refused
  push: fetch, re-apply, retry a bounded number of times, then fail with a clear message. The
  working tree and the current branch are never touched.
- **The working-tree file becomes a cache.** In shared mode the progress path is git-ignored and
  rewritten after every read, so the dashboard and tools that read the file keep working.
- **Claims.** A step may carry `holder: { by, branch, since }`: the person (from the git
  identity or `DOCZI_ACTOR`), the work branch, and the time. Setting `doing` takes the claim and
  is refused while another holder has it. `review` and `blocked` keep it; `done` and `todo` clear
  it. A claim older than `claimDays` (default 7) with no change is shown as stale and can be taken
  over on purpose, never silently.
- **One commit per change**, with a subject such as `progress: M2 / Orders / Quotes -> doing
(Name)`. The branch's log is the history; no separate history file in shared mode.
- **Agents are told.** The session-start hook lists what the current person holds and what others
  hold; the core rule says to claim before starting and to stop when a step is held by someone
  else.
- **Statuses live only here.** Plan documents describe what and why; they do not repeat a State.
  The progress skill and the setup skill say so, and `doczi check-status` reports plan tables that
  still carry one.

## Consequences

- **Positive:**
  - one record, the same from every branch, machine and tool;
  - a second start on a held step is refused at the moment it happens;
  - who changed what and when, without new storage;
  - still no dependencies and no service.
- **Negative:**
  - git must be on the path, and a claim needs the remote (an explicit `--offline` records the
    change locally and reports a conflict at the next sync);
  - progress is reviewed on its own branch, not beside the code;
  - the PHP and Python servers must speak to git too, or be read-only in shared mode, which the
    plan decides per step;
  - a contributor without push rights cannot claim;
  - a mirror shows a project's documents to everyone who can read the repository that hosts it.
- **Follow-ups:**
  - the hosted server backend (roadmap; its own ADR when it starts);
  - `docs/plans/storage.md` step 2 (store interface) and step 3 (history) are delivered here for
    shared projects; that plan is updated when this one is approved.

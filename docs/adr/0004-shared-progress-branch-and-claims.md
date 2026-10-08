# 0004. One shared copy of progress on a git branch per project, with claims

- Status: Accepted (2026-10-08); amended the same day: the shared copy lives in a hub
  repository, not in the project
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

1. **A branch per project in one hub repository** (`projects/<project name>`). doczi reads and
   writes it with git plumbing through a small local cache. A write is a new commit pushed
   without force: if someone pushed first, git refuses, doczi fetches, applies the change again
   and retries. A step records who holds it. The project keeps its progress file and documents
   on its code branches, as a copy that doczi rewrites from the hub.
   - _Pro:_ one copy for every branch and every machine; the refused push is the
     compare-and-swap, so two claims cannot both win; history comes free as the branch's log;
     nothing to install or host; every project's record in one place; no extra branch in the
     project.
   - _Con:_ every contributor needs push rights on the hub; a project's documents are readable
     by everyone with access to it; a claim needs the network; the project's committed file can
     be behind until the next sync.
2. **A dedicated progress branch in each project's own repository.** The same mechanism, on the
   project's remote.
   - _Pro:_ access follows the project; no second repository.
   - _Con:_ an extra branch in every project, and no single place that shows all projects. The
     owner chose option 1 for these two reasons.
3. **Status commits on the main branch.** Keep the file where it is and push each change there.
   - _Pro:_ nothing new to learn.
   - _Con:_ conflicts with branch protection and required reviews; fills the history with status
     commits; every feature branch still carries a stale copy and merges it back.
4. **A hosted doczi server.** A service holds progress; clients call it.
   - _Pro:_ instant claims, live dashboard, access control per person.
   - _Con:_ someone must run, secure and back it up; work stops when it is down; it breaks the
     "nothing to install" promise for small teams.
5. **Do nothing.** Projects keep their own conventions, and the drift stays.

## Decision

Option 1 now. Option 4 later, as another backend behind the same store interface, for teams that
want it; the hub branch stays the default and keeps working without a server.

- **The hub is a setting.** `.doczi.json` gains `"shared": { "url": "<hub repository>", "branch":
  "projects/<project name>", "docs": ["docs/**/*.md"], "claimDays": 7 }`. Without it, a project
  behaves exactly as today, so single-person projects change nothing. The owner's projects use
  the doczi repository as their hub; nothing in the code names it.
- **The hub branch decides; the project's file follows.** A change goes to the hub first and
  only then to the project's progress file. `doczi sync`, run at session start and by hand,
  rewrites the file from the hub.
- **The hub branch also carries the project's Markdown documents**, copied from the project's
  main branch on sync, so the record of a project is complete in one place. Binary files are
  left out.
- **The agent creates the hub branch.** doczi's rules and skills tell the agent working in a
  project to run `doczi share` when the branch is missing. It never replaces an existing branch.
- **A store interface** in `lib/store.mjs` (`read`, `change`, `history`) with two backends:
  `file` (today's behaviour) and `hub`. The CLI, the MCP server and the HTTP servers call only
  the interface. A later `server` backend plugs in here.
- **Writes are compare-and-swap.** Fetch the branch into a cache under `~/.doczi/hubs/`, apply
  the change, build the commit with plumbing (`hash-object`, `mktree`, `commit-tree`), push
  without force. On a refused push: fetch, re-apply, retry a bounded number of times, then fail
  with a clear message. The project's index and current branch are never touched.
- **Claims.** A step may carry `holder: { by, branch, since }`: the person (from the git
  identity or `DOCZI_ACTOR`), the work branch, and the time. Setting `doing` takes the claim and
  is refused while another holder has it. `review` and `blocked` keep it; `done` and `todo`
  clear it. A claim with no change for `claimDays` (default 7) is shown as stale and can be
  taken over on purpose, never silently.
- **One commit per change**, with a subject such as `progress: M2 / Orders / Quotes -> doing
  (Name)`. The branch's log is the history; no separate history file in shared mode.
- **Agents are told.** The session-start hook lists what the current person holds and what
  others hold; the core rule says to claim before starting and to stop when a step is held by
  someone else.
- **Statuses live only in doczi.** Plan documents describe what and why; they do not repeat a
  State. `doczi share` removes the repeated statuses itself, shows what it changed and keeps
  longer notes on the task; `doczi check-status` reports any that remain.

## Consequences

- **Positive:**
  - one record, the same from every branch, machine and tool;
  - a second start on a held step is refused at the moment it happens;
  - who changed what and when, without new storage;
  - every project's progress and documents in one repository;
  - still no dependencies and no service.
- **Negative:**
  - git must be on the path, and a claim needs the hub (an explicit `--offline` records the
    change locally and reports a conflict at the next sync);
  - every contributor of every project needs push rights on the hub, and can read the other
    projects' branches there;
  - if the hub is made public, every project's branch goes public with it;
  - the hub repository grows with every status change;
  - the project's committed progress file can be behind the hub until the next sync, and
    conflicts between code branches are settled by taking the hub's copy;
  - the PHP and Python servers must speak to git too, or be read-only in shared mode, which the
    plan decides per step.
- **Follow-ups:**
  - the hosted server backend (roadmap; its own ADR when it starts);
  - `docs/plans/storage.md` step 2 (store interface) and step 3 (history) are delivered here for
    shared projects; that plan is updated with step 10 of the plan.

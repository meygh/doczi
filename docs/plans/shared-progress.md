# Plan: a shared progress branch in each project

Status: approved by the owner (2026-10-08); scope reduced the same day (see "Decided by the
owner") · Milestone: v0.3 · ADR: [0004](../adr/0004-shared-progress-branch-and-claims.md) ·
Owner: Meisam Ghanbari

## Goal

Everyone who works on a project, on any branch and any machine, sees the same progress. doczi
stores every change in two places inside the project: the progress file in the project's
documents, and a shared branch that all code branches read from.

Stopping two people from starting the same step is not part of this plan. It comes with the
hosted doczi server (v0.4).

## Where things live

All of it in the project's own repository. Nothing is stored in doczi's repository.

- **The project's documents stay as they are.** The progress file (`docs/progress/…`) and the
  requirements, plans and decision records are on the code branches, reviewed with the code.
- **One shared branch per project,** `shared-progress` by default, on the project's own remote.
  It holds only the progress file. Its commit log is the progress log: who changed what, when.
- **doczi keeps the two in step.** A change made through the skills, the CLI, the MCP tools or
  the dashboard is written to the progress file and then synced with the shared branch. A sync
  also runs at session start, with a short time limit.
- **The agent sets it up.** At session start doczi says when a project has a remote and no
  shared branch yet; the setup and progress skills tell the agent to run `doczi share`. It never
  replaces a branch that already exists.

## Acceptance criteria (testable)

1. Two checkouts of one project, on different code branches and machines, show the same
   progress after `doczi sync`, without merging any code.
2. Two people changing different steps at the same time both succeed, and neither change is
   lost.
3. Two people changing the same step: the later change wins, and its sync says which earlier
   change it replaced and whose it was.
4. A change made while the remote is unreachable still succeeds in the progress file; doczi says
   the shared branch is behind, and the next sync delivers it.
5. A change made outside doczi's commands (the dashboard of the PHP or Python server, an edit by
   hand, a code merge that brought another copy of the file) is picked up by the next sync in
   the same way.
6. A sync never touches the project's index, its current branch or any file except the progress
   file.
7. `doczi progress log` lists the changes on the shared branch with the person and the time.
8. In a project with a remote and no shared branch, the session start text says so and names the
   command; after `doczi share` the branch exists on the remote and holds only the progress
   file; a second `doczi share` changes nothing.
9. `doczi share` removes the State column, or the status words, from the step tables of the
   project's plan documents, shows every line it changed, and keeps any text that is more than a
   status as the note of the matching task. `doczi check-status` lists what is left.
10. A project without `shared` in `.doczi.json` behaves exactly as in 0.1.1: the existing suite
    passes unchanged.

## What I read

`lib/store.mjs`, `lib/progress.mjs`, `lib/lock.mjs`, `lib/config.mjs`, `lib/local.mjs`,
`cli/doczi.mjs`, `mcp/server.mjs`, `server/node/server.mjs`, `hooks/session-start.mjs`,
`templates/progress/progress.schema.json`, `docs/API.md`, `docs/plans/storage.md`, `AGENTS.md`.

## Invariants touched

- **No dependencies:** kept. Git is called as a child process, with a timeout on every call.
- **One contract, three servers:** untouched. The HTTP API and the three servers do not change;
  they keep writing the progress file, and the sync carries the change to the shared branch.
- **One core:** the merge of two progress states lives in one module beside `lib/progress.mjs`.
- **Never overwrite user files:** `doczi share` refuses when the branch already exists, and shows
  the plan-document lines it changes before writing them.
- **Hooks never break a session:** the session-start sync is bounded (2 s) and silent on failure.

## Design

**Config.** `.doczi.json`:

```json
"shared": { "remote": "origin", "branch": "shared-progress" }
```

**Sync is one mechanism for every case.** doczi remembers the last state it synced (a commit id
kept under `.git/`, never committed). A sync compares three states, step by step and question by
question:

| State | Where it comes from |
| --- | --- |
| base | the last synced commit |
| mine | the project's progress file now |
| theirs | the shared branch after a fetch |

- Changed on one side only: that side's value is kept.
- Changed on both sides to the same value: nothing to do.
- Changed on both sides to different values: the shared branch's value is kept when it is newer
  than the local change, otherwise the local one; either way the sync reports it.
- New milestones, tasks, steps and questions from both sides are kept.

The result is written to the progress file and committed to the shared branch with git plumbing
(`hash-object`, `mktree`, `commit-tree`), then pushed without force. If someone pushed first, git
refuses; doczi fetches and merges again, at most five times with a short random wait.

**Every doczi write** (CLI, MCP) changes the progress file under the existing lock and then runs
a sync. A failed sync is reported and never undoes the change.

**Commits on the shared branch** carry the person's git identity and a subject such as
`progress: M2 / Orders / Quotes -> doing`. `.doczi.local.json` may set `actor` when the git
identity is not the name the team uses.

**Surfaces.**

- CLI: `doczi share`, `doczi sync`, `doczi progress log`, `doczi check-status`.
- MCP: no new tools; the existing ones sync after writing and say so in their answer.
- Hook: session start syncs and says when the project has no shared branch yet.
- Rules and skills: `rules/core.md` (statuses live only in doczi's progress; sync before
  starting a step), `skills/setup` and `skills/progress` (run `doczi share` when the shared
  branch is missing, and tell the user).

## Test plan

- Unit: the three-way merge for every case in the table, new and removed items, questions; the
  plan-table rewrite of `share`.
- Integration, with a bare repository as the remote and two clones on different branches:
  criteria 1 to 6 and 8; a forced race where one clone pushes between the other's fetch and
  push.
- Hook test: bounded sync, offline, and the text shown.
- Regression: the whole existing suite with no `shared` setting (criterion 10).

## Steps

Each step is one commit and starts with the failing test.

1. **[lead]** Three-way merge of two progress states. Verify:
   `node --test test/progress-merge.test.mjs`
2. **[lead]** Shared branch: fetch, read, commit with plumbing, push without force, retry, the
   last-synced marker. Verify: `node --test test/shared.test.mjs`
3. **[lead]** CLI `share`, `sync`, `progress log`; CLI and MCP writes sync afterwards. Verify:
   `node --test test/cli.test.mjs test/mcp.test.mjs`
4. **[lead]** Session-start sync and its text. Verify: `node --test test/hooks.test.mjs`
5. **[lead]** `share` removes repeated statuses from plan documents; `check-status`. Verify:
   `node --test test/cli.test.mjs`
6. **[delegable]** Rules, skills, README and the note in `docs/plans/storage.md`. Verify:
   `npm run check`

Estimate: four to five working days for the lead.

## Progress steps

Milestone v0.3, task "Shared progress branch". The task "Claims" moved to v0.4 with the hosted
server. Both are in `docs/progress/milestones.json`.

## Risks

- **Two people can still start the same step.** doczi shows the same statuses to everyone after
  a sync, so a step already `doing` is visible, but nothing refuses a second start. That is the
  server's job (v0.4).
- **Push rights.** A contributor who cannot push to the shared branch still works locally, but
  their changes reach nobody. Protected-branch rules must leave this branch open.
- **Branch naming rules.** A project that requires a purpose prefix on every branch needs an
  exception for the shared branch, or sets another name in `shared.branch`.
- **Same step changed twice.** The later change wins. The sync reports it, but a person has to
  notice the report.
- **The committed file differs between code branches.** Each code branch commits its own copy of
  the progress file, so merges can conflict on it. The answer is to take either side and run
  `doczi sync`, which restores the shared state.
- **Slow or missing network.** A sync costs a fetch and a push. Calls are bounded, and work
  never waits for them.
- **Rewriting plan documents.** Removing a State column can drop a note someone kept there.
  `share` shows the lines first and moves anything that is more than a status into the task's
  note.

## Decided by the owner (2026-10-08)

- The shared branch lives in each project's own repository, never in doczi's. Default name
  `shared-progress`.
- Changes are stored in the project's documents and on the shared branch. No copy elsewhere.
- Refusing a second start on a held step waits for the hosted server.
- `doczi share` removes repeated statuses from plan documents itself.

## Later: a hosted doczi server (v0.4)

Not part of this plan. A service that holds progress for many projects, so the dashboard is live,
access is per person, and a step that someone holds cannot be started by anyone else (claims,
with a stale limit and a deliberate take-over). It gets its own ADR. The shared branch keeps
working for projects that do not use the server.

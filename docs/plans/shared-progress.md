# Plan: one shared copy of progress, with claims

Status: approved by the owner (2026-10-08), amended the same day (where the shared copy lives) ·
Milestone: v0.3 · ADR: [0004](../adr/0004-shared-progress-branch-and-claims.md) ·
Owner: Meisam Ghanbari

## Goal

doczi is the only record of who is doing what in a project. Several developers, each with
several agents, see the same statuses from every branch and machine, and a step that someone
holds cannot be started by anyone else.

## Where the shared copy lives

On a branch per project in one hub repository: `projects/<project name>`. For the owner's
projects the hub is the doczi repository; any other team names a repository of its own.

- **The project gets no extra branch.** Its progress file and its documents stay where they are,
  on the code branches, reviewed with the code.
- **The hub branch is the copy that decides.** Every status change, claim, question and answer
  goes to the hub branch first, as a push without force, and only then to the project's own file.
  So the project's file is always a copy of the hub, never the other way round.
- **doczi keeps the two in step.** Changing progress through the skills, the CLI, the MCP tools
  or the dashboard updates the hub branch at once. `doczi sync` (also run at session start, with a
  short time limit) rewrites the project's progress file from the hub and copies the project's
  documents to it.
- **The agent sets it up.** At session start doczi says when a project has no hub branch yet; the
  setup and progress skills tell the agent to run `doczi share`, which creates
  `projects/<project name>` in the hub from the project's current file. It never replaces a branch
  that already exists.

What a hub branch holds:

- the progress file: milestones, tasks, steps and statuses, who holds what, questions and
  answers, labels;
- a copy of the project's Markdown documents (requirements, plans, decision records): the files
  tasks link to and the paths in `shared.docs`, by default `docs/**/*.md`. No pictures or other
  binary files;
- its commit log, which is the progress log.

A hub branch is an orphan branch. It shares no history with the code of the repository that
hosts it and is never merged into it. Nobody edits it by hand.

## Acceptance criteria (testable)

1. Two checkouts of one project, on different branches and machines, read the same progress
   after `doczi sync`, without merging anything.
2. When two writers set the same step to `doing` at the same time, exactly one succeeds; the
   other gets "held by <name> on <branch> since <time>" and exit code 1 (HTTP 409, MCP error).
3. Two writers changing different steps at the same time both succeed, and neither change is
   lost.
4. `done` and `todo` clear the holder; `review` and `blocked` keep it.
5. A claim with no change for `claimDays` (default 7) is marked stale in the summary, the
   dashboard and the session start text, and can be taken only with an explicit take-over that
   names the earlier holder in the commit.
6. A project without `shared` in `.doczi.json` behaves exactly as in 0.1.1: the existing suite
   passes unchanged.
7. A change never touches the project's index, its current branch or any file except the
   progress file.
8. With the hub unreachable, a status change fails with a clear message unless `--offline` is
   given; the next sync applies an offline change or reports the conflict.
9. In a project with no hub branch, the session start text says so and names the command; after
   `doczi share` the branch `projects/<project name>` exists in the hub and a second
   `doczi share` changes nothing.
10. `doczi share` removes the State column, or the status words, from the step tables of the
    project's plan documents, shows every line it changed, and keeps any text that is more than
    a status as the note of the matching task. `doczi check-status` lists what is left.
11. After `doczi sync` the hub branch holds the same Markdown documents as the project's main
    branch; a document deleted in the project disappears from the hub on the next sync.
12. `doczi check-docs` fails when a task links to a document or section that does not exist on
    the project's main branch.
13. After a merge leaves the project's progress file different from the hub, `doczi sync`
    restores it from the hub and says so.

## What I read

`lib/store.mjs`, `lib/progress.mjs`, `lib/lock.mjs`, `lib/config.mjs`, `lib/local.mjs`,
`cli/doczi.mjs`, `mcp/server.mjs`, `server/node/server.mjs`, `hooks/session-start.mjs`,
`templates/progress/progress.schema.json`, `docs/API.md`, `docs/plans/storage.md`, `AGENTS.md`.

## Invariants touched

- **No dependencies:** kept. Git is called as a child process, with a timeout on every call.
- **One contract, three servers:** the API gains the holder fields, the 409 answer and two
  endpoints; all three servers and the contract suite change in the same commit (step 6).
- **One core:** claim rules live in `lib/progress.mjs`; the PHP and Python servers mirror only
  the status-to-holder rule.
- **Never overwrite user files:** `doczi share` refuses when the hub branch already exists, and
  shows the plan-document lines it changes before writing them.
- **Hooks never break a session:** the session-start sync is bounded (2 s) and silent on failure.
- **Generic only:** the hub is a setting. Nothing in the code names the doczi repository.

## Design

**Config.** `.doczi.json`:

```json
"shared": {
  "url": "<hub repository>",
  "branch": "projects/<project name>",
  "docs": ["docs/**/*.md"],
  "claimDays": 7
}
```

`branch` defaults to `projects/` plus the project's name in lower case with dashes. An empty
`docs` list shares progress only. `.doczi.local.json` may set `actor` (the person's display name)
when the git identity is not the name the team uses.

**Store interface** (`lib/store.mjs`): `read(project)`, `change(project, fn, { message })`,
`history(project, filter)`. Backends: `file` (today) and `hub` (`lib/store-hub.mjs`).

**Hub backend.**

- A bare cache of the hub branch per project under `~/.doczi/hubs/`, fetched shallow and limited
  to that one branch, so the hub's code and other projects are never downloaded.
- Read: fetch the branch (bounded), read the progress file from it, write the project's progress
  file when it differs. When the fetch fails, use the last fetched state and say how old it is.
- Change: fetch; run `fn`; `git hash-object -w`; build the tree and `git commit-tree` on the
  fetched commit; push without force. Refused push: fetch and repeat, at most five times with a
  short random wait. Then write the project's progress file.
- Documents: `doczi sync` reads them from the project's main branch and commits the copy to the
  hub branch in the same way.
- The local file lock still wraps the whole change, so two agents on one machine queue up
  instead of racing each other to the hub.

**Claims** (`lib/progress.mjs`): a step may have `holder: { by, branch, since }`.

| Change | Holder |
| --- | --- |
| `doing` | taken; refused when another holder has it and the claim is not being taken over |
| `review`, `blocked` | kept |
| `done`, `todo` | cleared |

The same person on a different work branch counts as another holder, so one person's two agents
do not collide either. Take-over needs `--take` (CLI), `take: true` (MCP, HTTP).

**Surfaces.**

- CLI: `doczi share`, `doczi sync`, `doczi claim <milestone> <task> [step]`, `doczi release …`,
  `doczi progress mine`, `doczi check-status`, `doczi check-docs`; `doczi progress set … doing`
  claims.
- MCP: `progress_set_status` gains `take`; new `progress_claim`, `progress_release`; summaries
  and lists show holders.
- HTTP: holder in step objects, `409` with the holder for a refused change, `POST …/claim`,
  `POST …/release`.
- Dashboard: holder chip on a step, "Mine" and "Held by others" filters, a stale mark.
- Hook: session start syncs, lists what the person holds and what others hold in the current
  milestone, and says when the project has no hub branch yet.
- Rules and skills: `rules/core.md` (claim before starting; stop when held; statuses live only in
  doczi), `skills/implement-task` (claim in step 1), `skills/delegate-task` (the lead claims for
  the delegate's branch), `skills/setup` and `skills/progress` (run `doczi share` when the hub
  branch is missing, and tell the user).

## Test plan

- Unit: claim rules for every status change, stale limit, take-over, schema validation, the
  plan-table rewrite of `share`.
- Integration, with a bare repository as the hub and two project clones: criteria 1 to 5, 7 to
  9, 11 and 13; a forced race where one clone pushes between the other's fetch and push.
- Contract suite: holder fields, 409 and the two endpoints against Node, PHP and Python.
- Hook test: bounded sync, offline, and the text shown.
- Regression: the whole existing suite with no `shared` setting (criterion 6).

## Steps

Each step is one commit and starts with the failing test.

1. **[lead]** Store interface; the file backend moves behind it with no behaviour change.
   Verify: `npm test`
2. **[lead]** Claim rules in `lib/progress.mjs`, the schema and the format; file backend only.
   Verify: `node --test test/progress.test.mjs`
3. **[lead]** Hub backend: cache, read, compare-and-swap write, retry, the project's file
   following the hub, offline queue. Verify: `node --test test/store-hub.test.mjs`
4. **[lead]** CLI: `share`, `sync`, `claim`, `release`, `progress mine`. Verify:
   `node --test test/cli.test.mjs`
5. **[lead]** MCP tools and the session-start text. Verify:
   `node --test test/mcp.test.mjs test/hooks.test.mjs`
6. **[lead]** HTTP API in all three servers, `docs/API.md` and the contract suite. Verify:
   `node --test test/http-contract.test.mjs`
7. **[lead]** Dashboard: holder chip, filters, stale mark. Verify:
   `node --test test/web.test.mjs`
8. **[lead]** Documents: `sync` copies them to the hub branch; `check-docs`. Verify:
   `node --test test/store-hub.test.mjs`
9. **[lead]** `share` removes repeated statuses from plan documents; `check-status`; the rules
   and skills. Verify: `npm run check`
10. **[delegable]** README, migration guide, and the update to `docs/plans/storage.md`.

Estimate: ten to twelve working days for the lead.

## Progress steps

Milestone v0.3, tasks "Claims" and "Shared progress branch"; milestone v0.4, task "Hosted doczi
server". They are in `docs/progress/milestones.json`.

## Risks

- **Everyone needs push rights on the hub.** A contributor who cannot push to the hub repository
  cannot claim or change a status. For the owner's projects that means access to the doczi
  repository for every person on every project.
- **Private documents in the hub.** A project's requirements and plans can be read by everyone
  with access to the hub, including people on other projects. If the hub is ever made public,
  every `projects/` branch goes public with it. An empty `shared.docs` shares progress only.
- **The hub grows.** Every status change is a commit and document copies add history. Binary
  files are left out for that reason, and clones of the hub for other purposes should fetch one
  branch only.
- **The project's file can lag.** Between a change on another machine and the next sync, the
  committed progress file is behind the hub. The session start sync and every doczi command close
  the gap; reading the file by hand may show an older state.
- **Merges.** Two code branches carry different copies of the progress file and will conflict.
  The answer is always the hub's copy; `doczi sync` restores it.
- **Slow or missing network.** Every change costs a fetch and a push. Calls are bounded, and the
  last fetched state keeps reads working offline.
- **Wrong identity.** The holder's name comes from the git identity; two people sharing one
  identity look like one holder. `actor` in the local file fixes it.
- **Abandoned claims.** Only the stale mark and an explicit take-over; nothing is released
  automatically.
- **Rewriting plan documents.** Removing a State column can drop a note someone kept there.
  `share` shows the lines first and moves anything that is more than a status into the task's
  note.
- **PHP and Python.** Calling git from them adds process handling in two more languages. If step
  6 shows it is not worth it, they answer read requests in shared mode and refuse writes with a
  message that names the CLI.

## Decided by the owner (2026-10-08)

- The shared copy is a branch per project in the hub, `projects/<project name>`; the project
  itself gets no extra branch.
- The hub branch holds progress and the project's Markdown documents.
- A claim is stale after seven days.
- `doczi share` removes repeated statuses from plan documents itself.

## Later: a hosted doczi server

Not part of this plan. A service that holds progress for many projects, so claims are instant,
the dashboard is live and access is per person. It arrives as a third backend (`server`) behind
the store interface from step 1, with its own ADR; the hub backend stays the default and a
project can move between them with export and import.

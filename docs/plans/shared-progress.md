# Plan: one shared copy of progress, with claims

Status: draft, waiting for the owner's approval · Milestone: v0.3 ·
ADR: [0004](../adr/0004-shared-progress-branch-and-claims.md) · Owner: Meisam Ghanbari

## Goal

doczi is the only record of who is doing what in a project. Several developers, each with
several agents, see the same statuses from every branch and machine, and a step that someone
holds cannot be started by anyone else.

## Acceptance criteria (testable)

1. Two checkouts of one repository, on different branches, read the same progress after
   `doczi sync`, without merging anything.
2. When two writers set the same step to `doing` at the same time, exactly one succeeds; the other
   gets "held by <name> on <branch> since <time>" and exit code 1 (HTTP 409, MCP error).
3. Two writers changing different steps at the same time both succeed, and neither change is lost.
4. `done` and `todo` clear the holder; `review` and `blocked` keep it.
5. A claim older than `claimDays` is marked stale in the summary, the dashboard and the session
   start text, and can be taken only with an explicit take-over that names the earlier holder in
   the commit.
6. A project without `shared` in `.doczi.json` behaves exactly as in 0.1.1: the existing suite
   passes unchanged.
7. A write never changes the working tree's tracked files, the index or the current branch.
8. With the remote unreachable, a status change fails with a clear message unless `--offline` is
   given; the next sync applies an offline change or reports the conflict.
9. `doczi check-status` lists plan documents that still carry a State column or status words in a
   step table.

## What I read

`lib/store.mjs`, `lib/progress.mjs`, `lib/lock.mjs`, `lib/config.mjs`, `lib/local.mjs`,
`cli/doczi.mjs`, `mcp/server.mjs`, `server/node/server.mjs`, `hooks/session-start.mjs`,
`templates/progress/progress.schema.json`, `docs/API.md`, `docs/plans/storage.md`, `AGENTS.md`.

## Invariants touched

- **No dependencies:** kept. Git is called as a child process, with a timeout on every call.
- **One contract, three servers:** the API gains the holder fields, the 409 answer and two
  endpoints; all three servers and the contract suite change in the same commit (step 6).
- **One core:** claim rules live in `lib/progress.mjs`; the PHP and Python servers mirror only the
  status-to-holder rule.
- **Never overwrite user files:** `doczi share` moves the file to the branch and keeps a backup;
  it refuses when the branch already exists on the remote.
- **Hooks never break a session:** the session-start fetch is bounded (2 s) and silent on failure.

## Design

**Config.** `.doczi.json`:

```json
"shared": { "remote": "origin", "branch": "doczi-progress", "claimDays": 7 }
```

`.doczi.local.json` may set `actor` (the person's display name) when the git identity is not the
name the team uses.

**Store interface** (`lib/store.mjs`): `read(project)`, `change(project, fn, { message })`,
`history(project, filter)`. Backends: `file` (today) and `branch` (`lib/store-branch.mjs`).

**Branch backend.**

- Read: `git fetch <remote> <branch>` (bounded), `git show FETCH_HEAD:<path>`, then write the
  cache file at the progress path. When the fetch fails, read the last fetched ref and say how old
  it is.
- Change: read; run `fn`; `git hash-object -w`; build the tree and `git commit-tree` on the
  fetched commit; `git push <remote> <commit>:refs/heads/<branch>` without force. Refused push:
  fetch and repeat, at most five times with a short random wait.
- The local file lock still wraps the whole change, so two agents on one machine queue up
  instead of racing each other to the remote.

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
  `doczi progress mine`, `doczi check-status`; `doczi progress set … doing` claims.
- MCP: `progress_set_status` gains `take`; new `progress_claim`, `progress_release`; summaries and
  lists show holders.
- HTTP: holder in step objects, `409` with the holder for a refused change, `POST …/claim`,
  `POST …/release`.
- Dashboard: holder chip on a step, "Mine" and "Held by others" filters, a stale mark.
- Hook: session start lists what the person holds and what others hold in the current milestone.
- Rules and skills: `rules/core.md` (claim before starting; stop when held), `skills/progress`,
  `skills/implement-task` (claim in step 1), `skills/delegate-task` (the lead claims for the
  delegate's branch), `skills/setup` (offer `doczi share`; statuses live only in doczi).

## Test plan

- Unit: claim rules for every status change, stale limit, take-over, schema validation.
- Integration, with a bare repository as the remote and two clones: criteria 1 to 5, 7 and 8; a
  forced race where one clone pushes between the other's fetch and push.
- Contract suite: holder fields, 409 and the two endpoints against Node, PHP and Python.
- Hook test: bounded fetch, offline, and the text shown.
- Regression: the whole existing suite with no `shared` setting (criterion 6).

## Steps

Each step is one commit and starts with the failing test.

1. **[lead]** Store interface; the file backend moves behind it with no behaviour change.
   Verify: `npm test`
2. **[lead]** Claim rules in `lib/progress.mjs`, the schema and the format; file backend only.
   Verify: `node --test test/progress.test.mjs`
3. **[lead]** Branch backend: read, compare-and-swap write, retry, cache file, offline queue.
   Verify: `node --test test/store-branch.test.mjs`
4. **[lead]** CLI: `share`, `sync`, `claim`, `release`, `progress mine`. Verify:
   `node --test test/cli.test.mjs`
5. **[lead]** MCP tools and the session-start text. Verify: `node --test test/mcp.test.mjs
test/hooks.test.mjs`
6. **[lead]** HTTP API in all three servers, `docs/API.md` and the contract suite. Verify:
   `node --test test/http-contract.test.mjs`
7. **[lead]** Dashboard: holder chip, filters, stale mark. Verify: `node --test test/web.test.mjs`
8. **[lead]** `check-status`, and the rules and skills that make doczi the only place for
   statuses. Verify: `npm run check`
9. **[delegable]** README, migration guide, and the update to `docs/plans/storage.md`.

Estimate: eight to ten working days for the lead.

## Progress steps

Milestone v0.3, tasks "Claims" and "Shared progress branch"; milestone "Later", task "Hosted
doczi server". They are in `docs/progress/milestones.json` with this change.

## Risks

- **Push rights.** A contributor who cannot push to the progress branch cannot claim. The setup
  skill says which permission to grant; protected-branch rules must leave this branch open.
- **Slow or missing network.** Every change costs a fetch and a push. Calls are bounded, and the
  cache keeps reads working offline.
- **Shallow or partial clones, and CI.** `git fetch <remote> <branch>` works in both; a job that
  only reads uses the fetch without credentials.
- **Wrong identity.** The holder's name comes from the git identity; two people sharing one
  identity look like one holder. `actor` in the local file fixes it.
- **Abandoned claims.** Only the stale mark and an explicit take-over; nothing is released
  automatically.
- **PHP and Python.** Calling git from them adds process handling in two more languages. If step 6
  shows it is not worth it, they answer read requests in shared mode and refuse writes with a
  message that names the CLI.

## Open questions

1. Is `doczi-progress` the right default branch name?
2. Seven days as the stale limit?
3. Should `doczi share` also remove State columns from plan documents, or only report them
   (`check-status`)? The plan assumes report only.

## Later: a hosted doczi server

Not part of this plan. A service that holds progress for many projects, so claims are instant, the
dashboard is live and access is per person. It arrives as a third backend (`server`) behind the
store interface from step 1, with its own ADR; the branch backend stays the default and a project
can move between them with export and import.

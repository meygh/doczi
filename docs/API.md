# doczi API

doczi talks to projects in three ways. All of them read and write the same file in each
project (`.doczi.json` → `progress`, default `docs/progress/milestones.json`); doczi keeps no
database of its own.

| For | Interface | Start |
| --- | --- | --- |
| Agents (Claude Code, Codex) | MCP over stdio | Installed with the plugin (`.mcp.json`) or `doczi mcp` |
| People | HTTP dashboard + REST | `./serve` menu, or `doczi serve` |
| Scripts, CI | CLI | `doczi progress …` |

Projects are registered in `$DOCZI_HOME/projects.json` (default `~/.doczi/projects.json`) by
`doczi init` or `doczi projects add <path>`.

Until v0.3, every implementation also reads the legacy names. When both exist, the new name
wins.

- A project's `.solo-keel.json` is read when it has no `.doczi.json`.
- A `SOLO_KEEL_*` variable is read when the matching `DOCZI_*` variable is unset.
- `~/.solo-keel/projects.json` is read when no home is set and the `~/.doczi` folder does
  not exist yet.

See [ADR 0001](adr/0001-rename-to-doczi.md).

## The progress file

```json
{
  "title": "Shop: where we are",
  "updated": "2026-09-30",
  "docs": [{ "title": "Requirements", "path": "docs/SRS.md" }],
  "milestones": [
    {
      "id": "M0", "name": "Foundations", "when": "weeks 1–2", "weight": 2,
      "exit": "A fresh clone builds and runs with one command.",
      "docs": [{ "title": "M0 in the SRS", "path": "docs/SRS.md#m0-foundations" }],
      "blocked": "Optional: why the whole milestone is blocked",
      "tasks": [
        {
          "name": "Repository and tooling",
          "docs": [{ "title": "Plan", "path": "docs/plans/m0.md" }],
          "questions": [{ "q": "Which CI service?", "a": "GitHub Actions" }, { "q": "Sign images?" }],
          "steps": [
            { "status": "done", "title": "Repository layout" },
            { "status": "review", "title": "One command for lint and tests" },
            { "status": "blocked", "title": "CI", "reason": "Waiting for runner quota" }
          ]
        }
      ]
    }
  ]
}
```

| Status | Shown as | Counts toward progress |
| --- | --- | --- |
| `done` | Done | 1 |
| `review` | Waiting for your check | ¾ |
| `doing` | In progress | ½ |
| `blocked` | Blocked (needs `reason`) | 0 |
| `todo` | Not started | 0 |

A task's status is derived: **blocked** if any step is blocked (or the task has `blocked`),
**done** when every step is done, **review** when every step is done or waiting for a check,
**not started** when nothing has started, otherwise **in progress**. Milestones derive theirs
from their tasks the same way. Percentages are never stored.

`docs` paths are relative to the project root, may end in `#anchor` (a heading id, GitHub
style), must stay inside the project and may not contain `:`. Only `.md`, `.markdown` and `.txt` files open in the
reader. Schema: `templates/progress/progress.schema.json`.

## MCP tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `progress_summary` | `project?` | Overall and per-milestone bars, tasks by status, blocked, waiting for a check, in progress, open questions, next up |
| `progress_list` | `project?`, `milestone?` | Every task and step with status and number, plus questions |
| `progress_set_status` | `project?`, `milestone`, `task`, `step`, `status`, `reason?` | `M0 › Task › Step: todo → doing` |
| `progress_add_step` | `project?`, `milestone`, `task`, `title`, `status?` | Confirmation |
| `progress_ask` | `project?`, `milestone`, `task`, `question` | Records a question for the user |
| `progress_answer` | `project?`, `milestone`, `task`, `question`, `answer` | Records an answer the user gave, marked `"by": "agent"` until the user confirms it in the dashboard |
| `projects_list` | — | Registered projects |
| `rules_get` | `module?` | Text of a rule module |

`project` is a registered id or a path; by default the server's working folder (the
session-start hook tells the agent which path to pass). Writes go only to that project or to
registered projects. Tasks, steps and questions are referred to by name, a unique part of the
name, or 1-based number. Text from the progress file comes back labelled as data.

## HTTP

The same contract is implemented in Node.js (`server/node/server.mjs`), PHP
(`server/php/router.php`) and Python 3 (`server/python/server.py`), and checked by one test
suite (`test/http-contract.test.mjs`) against each runtime that is installed.

### Rules every implementation follows

- Listens on `127.0.0.1` only and answers only loopback clients. Default port `4800`.
- Rejects any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (`403`):
  blocks DNS-rebinding pages.
- Writes need `Content-Type: application/json` (`415` otherwise); when an `Origin` header is
  present it must be exactly `http://127.0.0.1:<port>` or `http://localhost:<port>` (`403`). Bodies over
  64 KiB are refused (`413`).
- Serves only the dashboard files (`index.html`, `app.js`, `markdown.js`, `theme.js`, `style.css`);
  everything else is `404`.
- Reads and writes only registered projects' progress files and the documents those files
  link. Every path must resolve inside the project after following symlinks; a symlinked
  progress file is refused.
- Every change holds the progress file's lock for its whole read → change → write: an
  exclusive `<file>.lock` holding a random token, created by whichever writer comes first (CLI,
  MCP, any server). Others wait up to 5 s (`DOCZI_LOCK_TIMEOUT_MS`), then get `503`. A lock
  older than 30 s is treated as left by a crashed writer and removed; a writer removes only its
  own lock.
- Writes are atomic (an exclusive, randomly named temporary file, then rename), keep one step
  per line, and set `updated` to today.
- Every response has `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; pages
  get `Content-Security-Policy: default-src 'self'`.
- Errors are JSON: `{ "error": "Human-readable message." }`; server errors do not include
  paths or stack traces.

### Endpoints

`GET /api/health` → `200 { "ok": true, "runtime": "node" | "php" | "python", "version": "0.1.0" }`

`GET /api/projects` → `200 { "projects": [ { "id": "flowforge", "name": "FlowForge", "hasProgress": true } ] }`

`GET /api/projects/{id}/progress` → `200` the progress file as stored · `404` unknown project
or no progress file.

`GET /api/projects/{id}/docs?path=docs/SRS.md` → `200 { "path": "docs/SRS.md", "text": "…" }`
· `404` when the path is not linked from the progress file, is not `.md`/`.markdown`/`.txt`,
leaves the project or does not exist · `413` over 2 MiB. An `#anchor` in `path` is ignored.

`PATCH /api/projects/{id}/steps` — change one step's status.

```json
{ "milestone": 0, "task": 4, "step": 6, "title": "Keycloak dev realms", "status": "blocked", "reason": "Waiting for the realm export" }
```

`milestone`, `task` and `step` are 0-based positions; `title` must equal the step's current
title, so a stale page cannot change the wrong step. `reason` is required for `blocked`
(up to 2000 characters) and removed for any other status.

`PATCH /api/projects/{id}/questions` — answer a question.

```json
{ "milestone": 0, "task": 4, "question": 0, "q": "Which CI service?", "answer": "GitHub Actions" }
```

`q` must equal the question's current text; `answer` up to 4000 characters. An answer saved here
is the user's: it removes the `"by": "agent"` marker that `progress_answer` sets.

Both PATCH endpoints return `200` with the whole updated progress file, or `400` bad JSON,
missing fields or a bad value · `404` unknown project or nothing at that position · `409` the
item at that position changed (reload and try again) · `503` another change held the file's lock
for longer than the wait (try again).

### Dashboard

`GET /` serves the dashboard: project switcher, search (`/`), linked documents in a reader,
whole-project progress and tasks-by-status bars with a filterable legend, a "Needs you" list
(blocked, waiting for your check, open questions), collapsible milestones and tasks with
status badges and blocked reasons, a status menu per step, and answers to questions. Every
change goes through the PATCH endpoints above.

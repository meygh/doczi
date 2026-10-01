# Plan: progress storage for large and busy projects

Status: draft, step 1 done · Owner: Meisam Ghanbari

## Goal

Keep the progress file readable in git for everyday projects, and give large or busy projects
a storage that handles many writers, keeps history and loads only what a view needs, without
changing how agents, the CLI or the dashboard talk to doczi.

## What hurts today

| Problem | Cause | Size where it bites |
| --- | --- | --- |
| Lost updates | Every writer does read → change → write; two writers at once and the later one silently drops the earlier change | Any size, as soon as an agent and a person (or two agents) work at once |
| Merge conflicts | One file per project; branches that touch progress conflict | Teams with parallel branches |
| No history | Only the current status is stored | Any project that wants "who changed this, when, why" |
| Whole-file reads | Every request parses the full file | Thousands of steps; noticeable only past ~10k |

Measured: FlowForge's 177 steps are ~15 KB. Parsing is not the bottleneck; concurrency and
history are.

## Design

`.doczi.json` gains `"storage": "json" | "sqlite"` (default `json`).

1. **JSON (default).**
   - Every change runs under a lock (step 1, below).
   - Optional split layout: `"progress": "docs/progress/"` holds `index.json` (title, docs,
     milestone order) plus one `M0.json` per milestone, for smaller diffs and fewer conflicts.
2. **SQLite.** `docs/progress/progress.db` in WAL mode, with tables:
   - `meta` (title, subtitle, docs);
   - `milestones`, `tasks`, `steps` (with an order column);
   - `questions`;
   - `events` (time, who: user / agent / cli, what, old → new, reason): the history.

   Only the milestone a view opens is loaded. `.gitignore` gets `progress.db-wal` and
   `progress.db-shm`; whether `progress.db` itself is committed is the project's choice.
3. **Moving between them.** `doczi export [--split]` writes readable JSON (for review or to
   commit a snapshot); `doczi import` loads JSON into SQLite.
4. **A store interface** in `lib/store`: `read(view)`, `change(fn)`, `history(filter)`. It is
   implemented by `json` and `sqlite`. The CLI, MCP and Node server call only this. PHP and
   Python get the same two backends behind their existing functions.
5. **API.** `GET /api/projects/{id}/history?step=…` (all three servers), and a "History" panel
   per step in the dashboard. The MCP tool `progress_history`.
6. **Cross-project index (optional).** `~/.doczi/index.db`, rebuilt from each project's
   store, for search across projects. It is never a source of truth.

## Runtime support (checked on this machine)

- Node.js: `node:sqlite`, available from Node 22 (prints an experimental warning on 24). The
  SQLite backend needs Node ≥ 22; the JSON backend keeps Node 20.
- PHP: `pdo_sqlite` (loaded in the tested 8.2 build; some minimal builds lack it; the server
  reports that clearly).
- Python: `sqlite3`, built in.

No new dependencies.

## Steps

1. **[lead] Lock every change to the JSON file.** Done.
   - Exclusive lock file `<progress>.lock`, created with an exclusive flag in Node, PHP and
     Python; up to 5 s wait; a lock older than 30 s counts as stale and is broken.
   - The whole read → change → write runs inside the lock.
   - Tests: concurrent CLI writers lose nothing; each server waits for a held lock, breaks a
     stale one, and answers 503 when the lock stays busy.
2. **[lead] Store interface** in `lib/store.mjs`; the JSON backend moves behind it with no
   behavior change.
3. **[lead] History for JSON:** append-only `<progress>.history.jsonl` written inside the lock,
   so history exists before SQLite does.
4. **[lead] SQLite backend (Node)** plus `export` / `import`; the shared suite runs against both
   backends.
5. **[lead] SQLite in the PHP and Python servers;** the contract suite runs for every
   runtime × backend.
6. **[lead] Split JSON layout** (`index.json` + per-milestone files).
7. **[lead] Dashboard:** a history panel and per-milestone loading.
8. **[delegable] Docs and the migration guide.** Mechanical once the contract is fixed.

## Risks

- `node:sqlite` is still experimental in Node 24; its API may change. Keep it behind the store
  interface and pin the behavior in tests.
- A committed `progress.db` cannot be reviewed or merged; recommend `export` for reviews.
- A lock file left by a crashed writer blocks others for up to 30 s (the stale limit).
- Network drives: the exclusive-create lock works on SMB, but not on every NFS setup. Document
  it.

## Open questions

1. Should agents' writes in SQLite projects also append a JSON export, so the change still shows
   up in pull requests?
2. What should the default split threshold for `doczi init` be (for example, more than 500
   steps suggests the split layout)?

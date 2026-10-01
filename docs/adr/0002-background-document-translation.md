# 0002. Translate documents in the background, in every runtime, with a SQLite queue

- Status: Proposed
- Date: 2026-10-02
- Requirements: maintainer requests of 2026-10-02; plan: [v0.2-translation](../plans/v0.2-translation.md)
- Changes: the "Document translation" part of [v0.2-dashboard](../plans/v0.2-dashboard.md)

## Context

The dashboard is translated into six languages, but the documents it links (requirements,
plans, ADRs) are not. The v0.2 plan made translation a manual command (`doczi translate <doc>
--to fa`) that runs only in the Node CLI and MCP server; the PHP and Python servers would only
serve files that already exist.

The maintainer wants something else:

- translation starts on its own, when a project is set up (`doczi init`) and whenever its progress
  changes;
- the result is real files in the project, not text made per request;
- a project served locally does the work on the user's machine, in the runtime that serves it
  (Node.js, PHP or Python);
- the hosted platform (Youshita) can run the same work on its server for the projects it hosts;
- hosted, low-cost or free translation services are used first; there is no GPU for a local
  model.

Translating a document is slow (seconds to minutes) and rate limited (a free tier may allow 50
requests a day). It cannot run inside a hook, a CLI call or an HTTP request. It needs a queue
that survives restarts, a cache so unchanged sections are not paid for twice, usage counts for
budgets, and a guarantee that only one worker translates a project at a time.

This touches three invariants:

- **No dependencies.** A queue needs storage that handles concurrent writers.
- **One contract, three servers.** The reader asks for a translated document and its status.
- **Hooks never break a session.** Progress writes from hooks must start translation without
  waiting for it.

## Options

1. **Manual command only (the current plan).** Simple, but nothing happens unless someone runs
   it, and PHP and Python users need Node anyway.
2. **Queue in JSON files under the lock.** No new storage, but every runtime has to rebuild
   leases, retries and usage counts on top of whole-file rewrites. Many small writes from three
   runtimes under one file lock would contend and corrupt more easily.
3. **Queue in SQLite, worker in every runtime.** SQLite ships with all three runtimes:
   `node:sqlite` from Node 22.13, `pdo_sqlite` in PHP, `sqlite3` in Python. It gives
   transactions, a lease row for "one worker per project", and indexed cache lookups. Each runtime
   carries its own worker, so a PHP-only or Python-only machine translates without Node.
4. **Queue in SQLite, worker only in Node.** Less code, but a project served by PHP or Python
   translates only when Node is installed, which the maintainer ruled out.

## Decision

Option 3.

- **Storage.**
  - One SQLite database per user: `~/.doczi/translate.db`, in WAL mode. It is never written into
    a project and never committed.
  - Tables: `jobs` (the queue), `sections` (cache by source-section hash, language and model),
    `usage` (per provider and month), `leases` (one worker per project, with a heartbeat).
  - The schema version is stored in the database. All three runtimes run the same SQL from one
    file, `lib/translate/schema.sql`.
- **Triggers.**
  - `doczi init` queues every document the progress file links.
  - Every successful progress change queues a cheap *scan* job for the project: the change in
    Node (`lib/store.mjs`), PHP and Python (`changeLocked`).
  - The scan hashes each linked document and queues only the ones that changed since their last
    translation.
  - `doczi translate [--now]` queues by hand.
  - Queueing is one short insert. It never waits for translation, and its failure never fails
    the write or the hook.
- **Workers.**
  - Whoever is running drains the queue: the server of the runtime that serves the dashboard
    (Node, PHP or Python), or, when no server runs, a detached `doczi translate --drain` started
    by the Node CLI after queueing.
  - The lease row makes sure only one worker per project is active. A lease whose heartbeat is
    older than 60 s is taken over.
  - A worker exits when the queue is empty, or pauses until the reset time when every provider is
    rate limited or over budget.
- **Output.**
  - `docs/i18n/<lang>/<path of the source>` in the project.
  - Each file starts with a machine-translation notice and a marker holding the source hash.
  - A worker overwrites a translated file only when it still carries the marker and its own hash
    is unchanged. A file someone edited by hand is kept, and the job reports it.
- **Providers.**
  - One built-in client for the widely used chat-completions HTTP API, which the low-cost hosted
    services offer. Named presets for those services live in one data file; a custom base URL
    covers the rest.
  - Settings live in `~/.doczi/providers.json`: order (the fallback chain), model, base URL, the
    *name* of the environment variable that holds the key, a monthly budget, and an enabled
    flag.
  - Keys are read from the environment only. They are never stored, logged or sent to the page.
- **Hosted.**
  - The hosted platform implements the same queue and the same job and section formats on its
    own server and database.
  - A local project can point its translation at the platform instead of a provider; it is a
    provider kind of its own, `doczi-remote`.
  - The details belong to the platform's own design. This ADR fixes only the formats it has to
    honor.
- **Runtime versions.**
  - Translation needs Node ≥ 22.13, PHP with `pdo_sqlite`, or Python with `sqlite3`.
  - Everything else keeps Node ≥ 20.
  - On an older Node, queueing is skipped with a one-line notice, and `doczi translate` explains
    why.
  - Node's worker runs in its own process with `--disable-warning=ExperimentalWarning`, so the
    experimental notice of `node:sqlite` never reaches a hook or the CLI output.

## Consequences

- **Positive:**
  - Documents follow the progress file without anyone running a command.
  - A PHP-only or Python-only machine translates on its own.
  - Unchanged sections are never sent twice, budgets are enforced, and two runtimes never
    translate the same project at once.
  - The same formats let the hosted platform take over the work later.
- **Negative:**
  - The translation pipeline (chunking, protecting code, links and terms, retries, budgets)
    exists three times, in Node, PHP and Python.
  - A shared fixture suite has to keep them equal, like the HTTP contract suite does today.
  - `node:sqlite` is still experimental before Node 25.7. Its API may change; it stays behind
    one small module with tests.
  - Document text leaves the machine and goes to the provider the user chose. Free tiers may
    keep it; the provider list shows each service's terms.
  - A new store (`translate.db`) and a new public contract (the translation status and the
    translated-document request).
- **Follow-ups:**
  - Steps in the "Translation" task of v0.2 (see the plan).
  - When the storage plan's SQLite backend lands, it reuses the same database helpers per
    runtime.
  - The hosted platform's design records how it serves `doczi-remote`.

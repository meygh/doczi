# Doczi, the next version: live, visual and automatic

Date: 2026-10-20 · For: Maison (owner) · Repository: `meygh/doczi` (v0.1.1, read on 2026-10-20) ·
First user: `meygh/atlas`

## 1. What exists today, and what the owner wants

**Today (read from the repository):** a plugin for Claude Code and Codex that ships rules, skills, reviewer
agents and guard hooks, and a project-progress tool. Progress is one JSON file per project
(`docs/progress/milestones.json`) with milestones, tasks and steps and five statuses; percentages are
computed. Agents reach it through an MCP server (10 tools), people through a dashboard served by
Node.js, PHP or Python, scripts through a CLI. There is a three-way merge on a `shared-progress` branch
(ADR 0004), claims as one file per task on a `coordination` branch (ADR 0005), machine translation of the
plan and its documents, and six interface languages. **Hard rules** (its `AGENTS.md`): no dependencies,
Node 20 standard library only; one HTTP contract implemented three times (Node, PHP, Python) and tested
against each; hooks never break a session; never overwrite user files.

**What the owner wants:**
1. A modern, compact dashboard with **Kanban, Gantt charts and graphs**: who is loaded with what, the
   state of projects, milestones and tasks, at a glance.
2. **Doczi does the project-management chores itself**: it listens live to the repositories, updates
   statuses and documents, assigns tasks, manages claims, pushes the changes and coordinates the
   agents, so agents stop spending tokens on it.
3. It should be **intelligent**: extract meaning from commit messages, comments, branches and file
   changes.
4. **Offline and free**: no online MCP or service; a local model or local search if one is needed.

## 2. The idea in one picture

```
 repositories (working trees, branches, coordination branch, optional GitHub reads)
        │  file watcher · git poll · optional PR and CI reader
        ▼
   EVENT LOG (append-only, one line per fact: commit, branch made, claim added, file changed, comment)
        │
        ▼
   RULES ENGINE (deterministic): ids in commits and branches, claims, merges → step status, flags
        │            ▲
        │            └── LOCAL INTELLIGENCE (optional): search index, classifier, summaries
        ▼
   STATE (progress file as source of truth, plus derived: owners, dates, load, forecast)
        │
        ├──► PROPOSALS INBOX (what Doczi wants to change, with the evidence, accept or reject)
        ├──► WRITERS: progress files, marked blocks in plan documents, claim files, decision files,
        │            committed as "Doczi" and pushed to the right branch
        └──► DASHBOARD (Kanban, Gantt, workload, charts) over live updates, and MCP tools for agents
```

**The principle that keeps it safe and cheap:** *deterministic rules decide and write; the local model, if
present, only suggests, and every suggestion is checked and shown before it changes anything.* A change
Doczi makes is never silent: it has a reason, the evidence, a commit, and an undo.

## 3. Options for the intelligence, free and offline

The owner asked whether Doczi needs an AI MCP or a local model with local RAG. **No online MCP is needed.**
Doczi is itself an MCP server (agents call it); it never has to be an MCP client. Three levels, each free:

| Level | What it is | Cost and dependencies | What it can do |
| --- | --- | --- | --- |
| **A. Rules and a local search index** (the default, build first) | Pattern rules over commits, branches, files and claim files; a lexical search index (BM25) written in plain JavaScript over documents, ADR sections, commits and comments, with the Persian folding Atlas already uses | Free, zero dependencies, deterministic, instant, runs anywhere Node runs | Link commits and branches to steps by id and by path; derive statuses; detect claims in conflict, stale work, overload; find the right document section for a step; draft task briefs from templates |
| **B. A local model through a provider interface** (optional, off by default) | Doczi talks over HTTP on `localhost` to a model server the owner runs: **Ollama** (MIT) first, or any server with an OpenAI-style local API (llama.cpp's `llama-server`, LM Studio, llamafile) | Free; offline once the model is downloaded; Doczi still has zero dependencies, because the model server is a separate program | Classify a commit or comment against a *short list* of candidate steps; summarize a thread or a document section; extract questions and decisions from comments; write the text of a proposal; semantic search with embeddings |
| **C. A hosted model or online MCP** | A cloud service | Not free at scale, needs the internet | Not recommended and not needed; not built |

**Models for level B** (open weights, run on a CPU, listed so you can choose; check each licence before
bundling anything, Doczi bundles none):

| Job | Suggested | Notes |
| --- | --- | --- |
| Embeddings for search, Persian and English | **bge-m3** (MIT) or multilingual-e5 (MIT) | Multilingual including Persian; a few hundred MB; fast on CPU |
| Classify, extract, summarize | **Qwen** family 3B to 8B (Apache-2.0), Mistral 7B (Apache-2.0), Gemma and Llama families (their own licences) | 8 GB of RAM is enough for a 3B to 4B model quantized (slow but usable); 16 GB for 7B to 8B. Constrained output (a JSON schema or a grammar) makes small models dependable for choosing among options |
| Hardware reality | A laptop CPU gives a few tokens per second on a 7B model | So Doczi uses the model in the background, in small jobs, never in the path of a page load |

**Honest limits.** Small local models are weaker in Persian than in English and weak at rewriting documents,
which is why Doczi never lets a model edit a document freely: documents change only through **marked blocks
generated from structured data** (section 6), and the model only picks from options or writes a short
proposal text. If a model is absent, everything still works at level A.

**Recommendation:** build levels A fully, then add B as an optional module behind one interface
(`lib/ai/provider.mjs`) with a fake provider for tests. Start B with **bge-m3 for search** and a
**4B to 8B model for classification and summaries**, measured on the Atlas data before turning it on.

## 4. Decisions to take first (one short ADR each)

Owner answers, 2026-10-20: decision 1 (Node only; PHP and Python frozen or retired) and decision 8 (the self-hosted hub is the primary mode, git the fallback) are **agreed**. Decisions 2 to 7 and 9 follow the recommendations unless the owner objects.

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | **One server or three.** Today every API change is made in Node, PHP and Python and tested three times. Live updates, file watching and git polling are Node-only in practice | **Node only for v0.2 and later.** Keep PHP and Python as read-only dashboards on the v0.1 contract (frozen), or retire them. It removes about two thirds of the work and token cost of every API change |
| 2 | **Where live logic runs** | A `doczi daemon` (Node, one process; the hub of 6.8 is the same process in public mode) started with `doczi serve`; it holds the watchers, the event log and the rules. The CLI, MCP server and dashboard talk to it, and fall back to direct file reads when it is not running |
| 3 | **Source of truth** | The progress file stays the source of truth for statuses; add stable step ids and optional fields. The event log is a cache that can be rebuilt from git |
| 4 | **How documents are updated** | Marked blocks generated from structured data (`<!-- doczi:block steps plan=m1-demo -->`), never free text edits. Humans own everything outside the markers |
| 5 | **What Doczi may write without asking** | Statuses derived by deterministic rules from hard evidence (a merge, a claim file, a branch), claim files, progress and plan blocks. Everything derived from a model or from ambiguous evidence goes to the **proposals inbox** first |
| 6 | **Where Doczi writes and pushes** | As author `Doczi` with the footer `Generated by: Doczi`, to the progress and coordination branches defined by ADR 0004 and 0005 (and straight to the main branch only where the project's own rule allows it, as Atlas does for planning files) |
| 8 | **Self-hosted server** | `doczi serve --public` on the owner's server is the hub: it owns claims, messages and presence, and enforces them. Git stays the durable record and the fallback when the hub is down. This replaces the "localhost only" rule of v0.1 deliberately, behind tokens and TLS (section 6.8) |
| 9 | **Agent-to-agent messages** | Built into Doczi (tools `send`, `inbox`, `ack`), stored on the hub, mirrored as short digests to the coordination branch. No chat product, no broker, no dependency |
| 10 | **Roles and autonomy** | Roles and permissions are enforced by the hub; questions escalate along lead, pm, owner with timeouts; scope, cost, security and roadmap questions are owner-only |
| 11 | **Build order** | Coordination first: the hub, messaging, roles and the questions inbox (phases H1 and H2) before the visual dashboard, so agents stop waiting on the owner as soon as possible |
| 7 | **Internet** | Fully offline by default. An optional read-only adapter reads pull requests, reviews and CI from GitHub through the `gh` login or a token the owner supplies; without it, Doczi uses git alone |

## 5. The data model, extended (backward compatible)

All new fields are optional, so existing progress files keep working.

| Level | New fields |
| --- | --- |
| Step | `id` (stable, for example `D4`), `owner` (an agent or person), `start` and `due` (dates), `estimate` (hours), `priority` (`P0` to `P2`), `needs` (step ids), `branch`, `pr` (number), `claimed` (date), `updated` (date), `tier` (light, standard, deep, a hint for the assigner) |
| Task | `owner`, `lanes` (free labels) |
| Project | `agents`: a list of `{name, role, weeklyHours, skills}` for load and assignment |
| Derived, never stored | percentages, a step's `stale` flag, load per agent, the critical path, forecast dates, burn-up and flow series |

Titles such as `[D4 Ilia] Form builder` in Atlas become `id: D4, owner: Ilia, title: Form builder` by a
one-time `doczi migrate-ids` that keeps the old title where it cannot parse. The Persian file and its
English translation are matched **by id, not by position**, so a new step cannot shift a translation.

## 6. The features

### 6.1 The dashboard

- **Overview (the wallboard):** project and milestone bars, a calendar strip with today, the blocked and
  waiting-for-check lists, agents with their load, and the next three decisions waiting for the owner,
  all on one screen without scrolling at 1440 px, and a compact version for a phone.
- **Kanban:** columns not started, in progress, waiting for your check, blocked, done; a card shows id,
  title, owner, priority, due date, age in the column, a branch or PR chip, and warning chips (stale, needs
  not done, over capacity). Swimlanes by agent, milestone or priority; filters; drag to change status
  (a drag writes through the same API, with undo and a reason prompt for blocked).
- **Gantt:** milestones and tasks as bars from `start` to `due`; where dates are missing, **planned from
  `needs` and `estimate` and each agent's weekly hours** by a simple forward scheduler; today line;
  dependencies as arrows; the critical path highlighted; zoom by week or month; Jalali and Gregorian
  axes; export as SVG.
- **Workload:** per agent, open steps, estimated hours against weekly capacity per week, a heat strip,
  and a flag when over capacity; a drag from one agent's lane to another proposes a reassignment.
- **Charts** (hand-written SVG, no library): burn-up per milestone, cumulative flow, throughput per week,
  cycle time histogram, a forecast band for each milestone (velocity-based, with the assumptions shown),
  and status mix per agent.
- **Live:** the page updates by server-sent events; a changed card flashes once; a connection chip shows
  live or stale.
- Keeps what exists: six languages with right-to-left, Jalali dates, light and dark, keyboard and
  screen reader, the document reader, and the translations. No framework: ES modules loaded by the page
  (the page's content policy allows its own origin only), split out of today's single `app.js`.

### 6.2 Live listening and ingestion (`doczi daemon`)

- **Watchers:** file watching of each registered project's working tree for the progress, plan, claim and
  decision files, with a polling fallback (so it works on Windows, WSL and network folders).
- **Git:** fetches the project's remotes on a schedule (a setting, default 60 seconds), then reads new
  commits, branches, tags and the coordination branch with plain `git` commands, tracking the last
  commit it saw per branch. Nothing is cloned or changed in the owner's working tree.
- **Optional GitHub reader:** pull request state (draft, ready, merged), reviews, comments and CI, through
  `gh` or a token, read-only. Without it the rules below fall back to git evidence.
- **Events** are normalized into an append-only log in `~/.doczi/`, each with source, time, project, ids
  found and a hash, so reprocessing never doubles anything.

### 6.3 The rules engine (level A intelligence)

Evidence in, status and flags out, deterministic and tested:

| Evidence | Meaning |
| --- | --- |
| A step id in a commit subject, body or trailer (`D4`, `Step: D4`), or in a branch name (`core/d4-form-builder`) | The commit and branch belong to step D4 |
| A claim file for D4 appears on the coordination branch | D4 is taken by that agent: owner set, step `doing`, `claimed` dated |
| A branch for D4 receives commits | `doing`; `updated` follows the last commit |
| A pull request for D4 is ready for review (reader) or a commit trailer `Step: D4 review` (offline) | `review` |
| A merge commit that names D4's branch or pull request into the main branch | `done`; the claim becomes `done` |
| A claim file deleted | the owner is cleared, status back to not started if no work exists |
| No commit on a `doing` step for N days (a setting) | flag `stale`, shown on the card and in the overview |
| Two claim files or two branches for one step | flag `conflict`, proposed resolution |
| A step starts while one of its `needs` is not done | flag `blocked by needs` (not a status change) |
| Commits touching files that a step's plan lists, with no step id | proposed link to that step |
| An owner's open work over their weekly hours | flag `over capacity` |

Every derived change is written with its evidence (commit ids, file, time) in the step's history, kept in
the event log and shown in the card's panel.

### 6.4 Claims, assignment and coordination

- **Tools that replace agent chores** (CLI and MCP, one short call each): `claim` a step,
  `release`, `done`, `review`, `block` with a reason, `ask` and `answer` a question, `decide` (writes a
  decision file), and `next` (what should I take). The daemon performs the git work on the coordination
  branch (the compare-and-swap push of ADR 0005) and returns one line. **An agent no longer edits plans,
  progress files or claim files by hand.**
- **Assignment engine:** for each free step, a ranked list of agents by dependency readiness, priority,
  remaining weekly hours, skills and recent files (so two agents are not given steps that change the same
  files in the same week, the rule Atlas already uses). The owner accepts in the dashboard with one click,
  or sets a mode where Doczi assigns steps that have a single clear candidate.
- **Coordination:** the daemon notices an agent that is waiting on a step that is late, a step nobody
  holds that is on the critical path, and two steps in one week that touch the same files; it posts the
  warning to the dashboard and writes it into the next session-start text for the agents concerned.
- **Messages to agents** are not sent live (agents have no inbox); they are written into the
  session-start context each agent receives, kept to a few lines.

### 6.5 Documents and comments

- **Marked blocks:** the plan tables of Atlas (state and owner columns), status counts, the "who builds
  what" table and the week plan become blocks generated from the progress file and the claims. Doczi
  rewrites only inside the markers, shows a diff in the proposals inbox when a block changed in a way not
  explained by data (a human edited it), and never touches text outside.
- **Two-language sync:** a new or renamed step's text goes to the translation file by id; the missing text
  is filled by a local model if enabled, else marked "needs translation" in the dashboard.
- **Comments:** from commit bodies, claim files (`## Decision:` and `## Question` headings), decision
  files and, with the GitHub reader, pull request and review comments. Level A extracts by headings and
  keywords; level B classifies a comment as a question, decision, blocker or note and proposes the
  matching action (add a question to the step, write a decision file, mark blocked).
- **Decisions:** Doczi writes `decisions/<date>-<topic>.md` on the coordination branch from the
  structured `decide` call and links it from the step.

### 6.6 Local search and retrieval (the "local RAG")

- **Index:** chunks of documents by heading, ADR sections, claim and decision files, commit messages and
  comments, with the project, path, section and last change. Level A is BM25 with the project's folding
  rules (Persian digits, letter forms and the half-space rule for Atlas); level B adds embeddings from a
  local model and merges the two rankings. Brute-force similarity over a few tens of thousands of chunks
  is fast enough in plain JavaScript; the index lives in `~/.doczi/index/` as files and is rebuilt
  incrementally by content hash.
- **Use:** the dashboard's search; the MCP tool `docs_search` that returns the three best sections with
  paths, so an agent reads a paragraph instead of a whole document; `doczi brief <step>`, which assembles
  a task prompt skeleton from the plan row, the step's needs and the best-matching ADR sections.

### 6.7 Cutting tokens, concretely

1. Session start injects a **short, per-agent state** (its steps, its next step, blockers, two warnings)
   instead of the agent reading plans.
2. Claims, status changes, questions and decisions are **one short tool call**, not file edits and pushes.
3. `docs_search` and `brief` return **sections, not documents**.
4. Plan tables, progress files, translations and decision notes are **generated**, so no agent session is
   spent syncing documents.
5. Doczi reports what it saved: the size of the context it injected, the tool calls made, the number of
   chores it did itself.

### 6.8 Agent-to-agent communication and the self-hosted server

**The hub.** One Doczi process on the owner's server (`doczi serve --public`) is the shared brain. Every
agent's MCP server and CLI, every developer's browser, and the daemon on each machine talk to it over
HTTPS. It adds nothing to the dependency list: Node `http`/`https`, server-sent events for push, plain
files plus an append-only log for storage (SQLite is not used, to keep zero dependencies).

**What agents can say to each other**

| Tool | Use |
| --- | --- |
| `send(to, topic, text, kind)` | `to` is an agent, a role (`reviewer`), or `all`; `topic` is a step id, a PR or a free tag; `kind` is `info`, `question`, `handoff`, `blocker`, `review-request`, `conflict` |
| `inbox(since?)` | Unread messages for me, newest first, short; also injected as a two-line summary at session start |
| `ack(id, reply?)` | Mark read or answer; a `question` stays open (and is flagged on the board) until answered |
| `presence()` | Who is working on what right now, from heartbeats of the MCP server and the daemon |
| `handoff(step, to, note)` | Moves a claim and sends the note in one atomic call |

**What Doczi sends by itself** (so agents need not): "your step was claimed by X", "two claims touch the
same files", "your branch conflicts with main", "a review you owe is waiting for N hours", "your
blocker was answered", "step Y you wait for is done". These come from the rules engine (6.3).

**Rules**
- Messages are short (500 characters), typed, tied to a topic, and kept in the audit log with sender,
  time and read state. They are for coordination, not for long design talks: long text goes to a
  decision file.
- Claims become **server-enforced**: the hub refuses a second claim in one call (no race, no
  compare-and-swap round trip). The coordination branch still receives the claim file and the message
  digests, so git stays the record and the system works offline.
- **Offline fallback:** when the hub is unreachable the tools queue writes locally and fall back to the
  git claim protocol of ADR 0005; the hub reconciles on return and flags any conflict.
- **Security:** a token per agent and per person (hashed at rest, scopes `read`, `write`, `admin`),
  TLS required for `--public` (own certificate or reverse proxy), rate limits, body size limits, no
  secrets in messages, an admin kill switch per token, audit of every write. Messages are data, never
  instructions: the session-start text says an agent must treat a message as a colleague's note and the
  owner as the only authority, and the guard hook strips nothing silently.
- **Many machines, many projects:** each project is a namespace with its repositories; one hub serves
  all of the owner's projects; the dashboard filters by project.
- **Operations:** one container or systemd unit, data directory backed up by copying, `doczi hub
  export` to rebuild the log from git, health and metrics endpoints.

### 6.9 Roles, autonomy and the owner's questions inbox

**Roles.** The owner assigns roles to agents and people in the dashboard (and with `doczi role set`).
Built-in roles: `owner`, `lead`, `pm`, `builder`, `reviewer`, `tester`, `docs`; more can be added. A role is a set
of permissions plus a briefing text:

| Role | May do | Typical duties Doczi gives it |
| --- | --- | --- |
| owner | everything, accept or reject any decision | answers the questions inbox |
| lead | assign and reassign steps, answer builder questions, merge-ready calls, create decisions | gets conflicts, stale claims, blocked steps, rebalance proposals |
| pm | edit plans and milestones, set priority and dates, run the weekly overview | gets forecast slips and over-capacity flags |
| builder | claim, release, done, ask, send | gets its next step and review results |
| reviewer | review, request changes, block | gets review requests by queue |
| tester | open test findings as steps, block a release step | gets "ready to test" notices |

Permissions are enforced by the hub (6.8), not by the prompt. An agent without the right cannot do the call.

**Working without the owner.** Questions go first to the asker's nearest authority (a builder asks the
`lead`, the lead asks the `pm`, the `pm` asks the `owner`) with a timeout and an escalation rule per
question kind. The `lead` role can answer anything marked `delegable`; decisions that change scope, cost,
security or the roadmap are marked `owner-only` by default and always reach the owner. Every answer is
logged with who gave it, so the owner can review and reverse.

**The questions inbox (one place, live).** A dashboard page listing every open question from every agent
and project:
- columns: project, step, asker, role asked, kind (`decision`, `clarify`, `blocker`, `review`), priority,
  age, status (`open`, `answered`, `deferred`, `reversed`), who may answer;
- filters (project, agent, role, kind, status, priority, age, text) saved as named views, sorting on any
  column, grouping, multi-select, bulk answer / defer / reassign / change priority, keyboard use;
- live: new questions and answers appear over server-sent events with a badge and an optional desktop
  notification; an answer is delivered to the asker's next tool call or at once if it is connected;
- each question shows its context (step, recent messages, the evidence), the options the asker proposed
  and a recommended one, so the owner can answer with one click or a sentence;
- answered questions stay searchable as decisions, and may be saved as decision files (6.5).

**Atlas's question protocol today (owner, 2026-10-23) and how Doczi absorbs it.** Atlas agents ask in
one of two places, both read by the lead's coordination desk, a scheduled lead session that runs every
hour: a `Question:` comment on the pull request, or a file `questions/<date>-<Name>-<topic>.md` on the
`coordination` branch with `State: open | needs owner | answered` and an `## Answer` section. Doczi does
not break this. The hub (H1) imports both sources as questions (the pull request comment through the
optional GitHub reader, the file through the coordination watcher) and maps `open` to `open`,
`needs owner` to `owner-only` and `answered` to `answered`, writing the answer back into the file and
the comment so git readers stay correct. The lead role replaces the hourly desk: it is notified at once
and the desk session is only a fallback. Questions asked through the hub get a mirrored file on
`coordination`, so an agent that has not adopted Doczi still sees them.

## 7. The phases

Each phase ends with its tests green (`npm run check`), documents updated, and a short demo on the Atlas
data. Effort: S about a day or two of agent work, M about three to five, L about a week. Tier is a hint:
light, standard, deep.

| # | Phase | What it delivers | Effort | Tier |
| --- | --- | --- | --- | --- |
| H1 | Coordination core (first) | Minimal hub (`doczi serve --public`) with tokens and TLS, projects, agents, **roles and permissions**, server-enforced claims, `send` `inbox` `ack` `presence` `handoff`, automatic notices, the questions and answers model, session-start briefing, offline fallback to git, deployment guide | L | deep |
| H2 | Questions inbox and team page | The live questions inbox of 6.9 (filters, saved views, sort, bulk actions, notifications), the roles and team page, the live activity feed | M | standard |
| D0 | Decisions and groundwork | ADRs for section 4; split `web/app.js` into modules; freeze PHP and Python on the v0.1 contract (or retire); the event and state formats | S | deep for the ADRs, light for the split |
| D1 | Data model | The optional fields, schema, `migrate-ids`, id-based translations, importer and MCP tools updated, tests | M | standard |
| D2 | Kanban and compact overview | The board, swimlanes, filters, drag with undo, the wallboard | M | standard |
| D3 | Gantt and charts | Scheduler (needs, estimates, capacity), Gantt, burn-up, cumulative flow, throughput, cycle time, forecast, SVG export | L | standard |
| D4 | Workload | Agents list, per-agent load, over-capacity flags, the lane view and reassignment proposal | S | standard |
| D5 | The daemon and live updates | Watchers with polling fallback, git poller, the event log, server-sent events, reconnect, Windows and WSL checks | L | deep |
| D6 | The rules engine | The table of section 6.3, history per step, flags, the proposals inbox | L | deep |
| D7 | Claims, assignment and coordination | The tools of 6.4, the coordination-branch writer with compare-and-swap, the assignment engine, the session-start briefing | L | deep |
| D8 | Documents | Marked blocks, the block writer and diff check, two-language sync, decision files, commits as `Doczi` with the footer, push rules | M | standard |
| D9 | Local search and the optional local model | BM25 index with Persian folding, `docs_search`, `brief`, the provider interface with Ollama and a fake, classification of comments, summaries, embeddings; accuracy measured on Atlas | L | deep for the interface and safety, standard for the rest |
| D11 | Hub completion | What H1 left out: git digests mirrored to the coordination branch, reconcile after outages, backup and `doczi hub export`, load and security tests | M | deep |
| D10 | Hardening and adoption | Security pass, the optional GitHub reader, performance on a large project, backup and rebuild of the event log, docs, the Atlas adoption (below), the measured token savings | M | standard |

**Build order (decision 11): D0, H1, H2, then D1 to D4, D5 to D8, D9, D11, D10.** H1 needs only D0's decisions and the event format. Order of value for the rest: D1, D2, D3 give the visuals the owner wants first, from data that already exists; D5 to D8
give the automation; D11 turns it into a shared team service (build it before D10 so hardening covers it); D9 adds the intelligence last because levels A already carry most of the value.

## 8. Adopting it in Atlas

1. Add ids and owners to Atlas's progress files with `migrate-ids`; add the markers to
   `docs/plans/m1-demo.md` and `docs/plans/v1.md`.
2. Register Atlas and the coordination branch; start the daemon on the owner's machine.
3. Install the session-start briefing for every agent; update Atlas's coordination rules so agents call
   `claim`, `done`, `decide` instead of editing files.
4. Run Doczi in **watch-only mode for a week** (it proposes, it does not write), compare its proposals
   with what the team does by hand, fix the rules, then turn on automatic writing for the rule-based
   changes.
5. Retire the manual chores in `docs/agents/coordination.md` that Doczi now does, including the hourly
   desk session once the hub's lead notifications have run for a week without a missed question.
6. Use Atlas's existing ids (A9, C5, O1, E7 ...) as they are: `migrate-ids` must skip steps that already
   have ids, and the owner column (Kaveh is active again for light steps) is read from the plan tables
   as written, never hard-coded.

## 9. Risks

| Risk | Answer |
| --- | --- |
| A wrong automatic change spreads wrong status | Hard evidence only, evidence shown, undo, a week of watch-only mode, a kill switch (`doczi daemon --read-only`) |
| Plan documents are edited by hand and by Doczi | Marked blocks only; a diff check; Doczi never writes outside markers |
| Agents ignore the tools and edit files | The session-start text says so; the guard hook can block edits to generated blocks and claim files and name the tool to use |
| Local model is too weak in Persian | Level A works without it; classification chooses among options; accuracy is measured before it is switched on |
| Windows file watching and paths | Polling fallback; tests on Windows and WSL; no shell-outs beyond `git` |
| Growth in scope | Phases are independent; D1 to D4 already deliver the visual part |
| The three-server contract slows everything | Decision 1 |
| Secrets in the event log | The log stores ids and hashes and short subjects, never diffs; tokens stay in the OS credential store of `gh` |

## 10. How to start

1. Decide section 4 (a short call, or answers to the eleven rows).
2. Give the first Doczi agent session the **master prompt** and the **D0 prompt** from
   `next-version-prompts.md`.
3. After D0 is merged, run D1 and then D2 and D3 in parallel (different files), and D5 beside them.
4. Do a first review with the owner after D2, because the look of the board is the part people judge first.

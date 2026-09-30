# keel

The part of every project that keeps it steady: **how the work is done** (rules, workflow
skills, reviewer agents, hooks) and **where the work stands** (milestones → tasks → steps,
with progress bars that compute themselves). One install serves every project, in Claude Code
and Codex, and never overrides a project's own setup.

## What you get

| | |
| --- | --- |
| **Rules** (always on, per project switchable) | Read before you claim · plan, then build · test first · smallest correct diff · look up current APIs · say what you did not verify · clean code · no AI footprint · lead/secondary agent delegation |
| **Skills** | `/keel:plan-feature` · `/keel:implement-task` · `/keel:delegate-task` · `/keel:review-delegated` · `/keel:adr` · `/keel:commit` · `/keel:clean-code` · `/keel:ui-ux` · `/keel:progress` · `/keel:setup` |
| **Reviewer agents** | `security-reviewer` · `test-writer` · `ux-reviewer` · `perf-reviewer` |
| **Hooks** | Rules and a progress line at session start · blocks edits to protected files (secrets, generated code) · blocks AI tool names and attribution in code, commits and PRs |
| **Progress API** | MCP tools for agents · REST + dashboard for people (Node.js, PHP or Python) · CLI for scripts |
| **Upstream skills** (optional, pinned) | [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT) · [engineering](https://github.com/anthropics/knowledge-work-plugins/tree/main/engineering) (Apache-2.0) |

Plugin skills are namespaced (`/keel:…`), so a project's own `plan-feature` or `ui-ux` keeps
working unchanged. Rules come from a session-start hook and can be switched off per project.

## Install

Needs Node.js 20 or newer.

### Claude Code

```text
/plugin marketplace add meygh/keel
/plugin install keel@keel
/plugin install ui-ux-pro-max@keel      # optional
/plugin install engineering@keel        # optional
```

The MCP server comes with the plugin.

### Codex

```bash
codex plugin marketplace add meygh/keel
codex plugin add keel@keel
codex plugin add ui-ux-pro-max@keel     # optional
codex plugin add engineering@keel       # optional
```

Codex asks you to trust the plugin's hooks once. Codex does not expand plugin paths in MCP
settings, so add the MCP server with the path to your keel copy:

```bash
codex mcp add keel -- node /path/to/keel/mcp/server.mjs
```

### The `keel` command (dashboard, CLI, git hook)

```bash
npm install -g github:meygh/keel
```

Or clone this repository and run `node cli/keel.mjs …` from it.

## Use it in a project

```bash
cd your-project
keel init --check "make check"
```

`init` writes `.keel.json`, a starter `docs/progress/milestones.json` and registers the
project with the dashboard. It never overwrites existing files. In an agent session,
`/keel:setup` walks through the same with you and drafts milestones from your roadmap.

Then:

```bash
keel progress                                   # where we stand
keel progress --milestone M0                    # every step, numbered
keel progress set M0 "Repository" 2 doing       # task and step by name, part of a name, or number
keel progress set M0 "Repository" 3 blocked --reason "Waiting for runner quota"
keel progress add M1 "Main flow" "Search page"
keel progress ask M1 "Main flow" "Guest checkout in v1?"
keel progress answer M1 "Main flow" 1 "Yes"
keel git-hooks                                  # commit-msg hook: strips assistant attribution
keel check-ai                                   # scan tracked files for AI tool mentions
```

Agents do the same through MCP (`progress_summary`, `progress_set_status`,
`progress_ask`, …): they mark steps started, **waiting for your check** or blocked (with the
reason), and leave questions for you on the task instead of guessing.

## Dashboard

```bash
./serve          # macOS, Linux, Git Bash
serve.cmd        # Windows
keel serve       # anywhere keel is installed
```

A short menu shows which of **Node.js**, **PHP** and **Python 3** are installed, suggests a
free port and opens the browser:

```text
  keel · project dashboard
  ──────────────────────────────
  Projects registered: 3  (/home/sam/.keel)

  Serve it with:
    1) Node.js   v24.0.2
    2) PHP       8.2.12
    3) Python 3  3.14.4
    q) Quit

  Choose [1]:
```

Non-interactive: `./serve --runtime php --port 4800 --no-open` (PowerShell:
`serve.cmd -Runtime php -Port 4800 -NoOpen`). All three servers implement the same
[API](docs/API.md), listen on `127.0.0.1` only, refuse foreign hosts and cross-site writes,
and only write to registered projects' progress files.

What the dashboard gives you:

- **Whole project** bar, and a **Tasks by status** bar with a colored legend (Done, Waiting
  for your check, In progress, Blocked, Not started) that filters the list when clicked.
- **Needs you:** everything blocked (with the reason), waiting for your check, or waiting for
  your answer, one click from the task.
- **Collapsible milestones and tasks** with status badges; a **?** next to anything blocked
  shows why (hover or click).
- A **status menu on every step** (blocked asks for the reason), and **questions and answers**
  per task that you can answer in place.
- **Linked documents** (requirements, architecture, plans, ADRs) at project, milestone and
  task level, opened in a reader that renders Markdown and jumps to the linked section.
- **Search** (press `/`), paging or "Show all", light, dark and system themes, phone layout.

Every change is saved straight to the project's progress file.

`keel init --page` also copies the page next to a project's progress file, for a standalone
view that works without keel.

## `.keel.json`

```json
{
  "name": "Shop",
  "check": "make check",
  "progress": "docs/progress/milestones.json",
  "rules": ["core", "clean-code", "no-ai-footprint", "delegation"],
  "aiFootprint": { "check": true, "allow": ["src/providers/"], "terms": [] },
  "protect": [".env", ".env.*", "*.pem", "*.key", "**/secrets/**", "**/gen/**"]
}
```

Everything is optional. `rules: false` turns the rule context off (useful when the
project's own `CLAUDE.md`/`AGENTS.md` already says the same). `aiFootprint.allow` lists paths
that must name AI vendors; configuration files for the tools are always allowed.

## Progress file

```json
{
  "title": "Shop: where we are",
  "updated": "2026-09-30",
  "docs": [{ "title": "Requirements", "path": "docs/SRS.md" }],
  "milestones": [
    {
      "id": "M0", "name": "Foundations", "when": "weeks 1–2", "weight": 2,
      "exit": "A fresh clone builds and runs with one command.",
      "docs": [{ "title": "M0 in the requirements", "path": "docs/SRS.md#m0-foundations" }],
      "tasks": [
        {
          "name": "Repository and tooling",
          "questions": [{ "q": "Which CI service?", "a": "GitHub Actions" }],
          "steps": [
            { "status": "done", "title": "Repository layout and README" },
            { "status": "review", "title": "One command for lint and tests" },
            { "status": "blocked", "title": "Continuous integration", "reason": "Waiting for runner quota" }
          ]
        }
      ]
    }
  ]
}
```

A step is `done` (counts 1), `review` — waiting for your check (¾), `doing` (½),
`blocked` with a `reason` (0) or `todo` (0). A task is the share of its steps, a milestone
the average of its tasks, the project the milestones weighted by `weight`. Task and
milestone statuses are derived from their steps. Details: [docs/API.md](docs/API.md); schema:
[`templates/progress/progress.schema.json`](templates/progress/progress.schema.json).

## Fork or connect

- **Connect (recommended):** install the plugin, run `keel init` per project. Projects keep
  only `.keel.json` and their progress file; updates arrive with the plugin.
- **Fork:** fork this repository, change rules and skills to taste, and point the
  marketplace commands at your fork.

## Develop

```bash
npm run check    # all tests (the HTTP suite runs against each installed runtime) + AI-mention scan
```

See [AGENTS.md](AGENTS.md) for the rules of this repository and [docs/API.md](docs/API.md)
for the API contract.

## License

MIT. Upstream plugins listed in the marketplace keep their own licenses.

---
name: progress
description: Show or update the project's milestone progress (milestones → tasks → steps with computed progress bars), mark steps started, waiting for a check, done or blocked, ask or answer questions on tasks, link documents, or open the dashboard. Use when the user asks where the project stands, what is next or blocked, or to record progress.
argument-hint: "[summary | set <milestone> <task> <step> <status> | add … | ask … | answer … | serve]"
---

Progress: $ARGUMENTS

The data lives in the project (`.solo-keel.json` → `progress`, default
`docs/progress/milestones.json`). Percentages are always computed; never write them anywhere.

| Status | Means | Counts |
| --- | --- | --- |
| `done` | Finished and checked | 1 |
| `review` | Your part is done; the user should check it | ¾ |
| `doing` | Started | ½ |
| `blocked` | Cannot continue; always give a `reason` | 0 |
| `todo` | Not started | 0 |

Use, in order of preference:
1. solo-keel MCP tools: `progress_summary`, `progress_list`, `progress_set_status` (with `reason`
   for blocked), `progress_add_step`, `progress_ask`, `progress_answer`.
2. The CLI (`solo-keel …`, or `node <solo-keel>/cli/solo-keel.mjs …`):
   - `solo-keel progress` — summary; `solo-keel progress --milestone M0` — every step, numbered
   - `solo-keel progress set M0 "CI pipeline" "Image signing" blocked --reason "No registry yet"`
     (milestone id; task and step by name, unique part of a name, or 1-based number)
   - `solo-keel progress add M1 "Compiler" "Cycle rules"`
   - `solo-keel progress ask M1 "Compiler" "Should cycles be an error or a warning?"`
   - `solo-keel progress answer M1 "Compiler" 1 "An error"` (only answers the user gave)
3. Editing the JSON by hand: keep one step per line, bump `updated`.

Linking documents: add `docs` entries (`{ "title": "…", "path": "docs/SRS.md#section" }`) at
project, milestone or task level so people can open the requirement, plan or ADR behind the
work from the dashboard. Paths are relative to the project root and stay inside it.

When the user asks "where are we", answer with the overall percentage, the current milestone
and its percentage, anything blocked (with reasons), anything waiting for their check, open
questions for them, and the next two or three steps.

No progress file yet? Offer `solo-keel init`, or build one from the project's roadmap (one
milestone per phase, one task per deliverable, steps small enough for one commit, `docs` links
to the roadmap sections) and show it before writing.

The dashboard: `solo-keel serve` (or the `serve` menu in the solo-keel folder) shows every registered
project and saves changes straight to the file; it runs on Node.js, PHP or Python.

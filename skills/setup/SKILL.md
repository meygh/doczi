---
name: setup
description: Set up solo-keel in a project — .solo-keel.json, progress file, optional git hooks for commit messages, and registration with the dashboard — without overwriting anything the project already has.
argument-hint: "[project path, default: current]"
---

Set up solo-keel in: $ARGUMENTS (nothing given means the current project).

1. Read what exists first: `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, `.agents/`,
   `.githooks/`, `core.hooksPath`, and any roadmap or milestone document. List what you found.
2. Propose the `.solo-keel.json` values and wait for a yes:
   - `name`, `check` (the project's full check command);
   - `progress` path (keep an existing tracker's path);
   - `rules`: which of `core`, `clean-code`, `no-ai-footprint`, `delegation` to switch on —
     turn off any the project's own rules already cover, to avoid duplication;
   - `aiFootprint.allow`: extra paths that must name AI vendors (provider adapters);
   - `protect`: generated folders and secret files agents must not edit.
3. Run `solo-keel init <path>` with the agreed flags. It never overwrites existing files; it
   reports what it skipped.
4. Offer `solo-keel git-hooks <path>` to add the `commit-msg` hook that strips assistant
   attribution. If the project already sets `core.hooksPath`, add the hook to that folder
   instead and say so.
5. If there is a roadmap but no progress file, draft the milestones from it (see
   `/solo-keel:progress`) and show the draft before writing.
6. Finish with `solo-keel progress` to show the starting point.

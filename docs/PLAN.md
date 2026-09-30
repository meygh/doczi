# Plan: solo-keel v0.1

Status: approved approach (hybrid), in progress · Owner: Meisam Ghanbari

## Goal

One repository that any project can use for (1) how agents work — rules, skills, reviewer
agents, hooks — and (2) project management — milestone/task/step progress with bars that
compute themselves. It works in Claude Code and Codex, never overrides a project's own setup,
and projects talk to it through an API instead of copying files around.

## Decisions

| Topic              | Decision                                                                                      | Why                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Distribution       | A plugin + marketplace in this repo (`.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`) | Plugin skills are namespaced (`/solo-keel:plan-feature`), so they never shadow a project's own skills. A personal skill in `~/.claude/skills` would override a project skill with the same name. Codex also reads `.claude-plugin/plugin.json`. |
| Always-on rules    | `rules/*.md`, injected by a `SessionStart` hook                                               | Plugins cannot ship a `CLAUDE.md`/`AGENTS.md`; a hook adds the rules as context in both tools. Projects switch modules off in `.solo-keel.json`.                                                                                                |
| Hooks              | Node scripts, one `hooks/hooks.json` for both tools                                           | No bash/jq dependency (Windows). Codex maps `Write`/`Edit` matchers to `apply_patch` and sets `CLAUDE_PLUGIN_ROOT`. Blocking uses the JSON `permissionDecision: "deny"` output both tools read.                                            |
| Third-party skills | Listed in solo-keel's marketplace, pinned by commit, fetched from upstream                         | ui-ux-pro-max (MIT) and engineering (Apache-2.0) stay with their authors; no vendored copies.                                                                                                                                              |
| Project data       | Stays in the project: `docs/progress/milestones.json` + `.solo-keel.json`                          | The project owns its plan; solo-keel only reads/writes it through the API.                                                                                                                                                                      |
| API                | MCP server (stdio) for agents; HTTP REST + dashboard for people; CLI for scripts              | Agents update progress while working; people see all registered projects in one place.                                                                                                                                                     |
| Dependencies       | None (Node ≥ 20 standard library only)                                                        | Plugins are cloned, not `npm install`ed; nothing to audit or break.                                                                                                                                                                        |

## Layout

```
.claude-plugin/{plugin,marketplace}.json   .codex-plugin/plugin.json   .agents/plugins/marketplace.json
.mcp.json                  solo-keel MCP server for the plugin
rules/                     core, clean-code, no-ai-footprint, delegation (always-on context)
skills/                    plan-feature, implement-task, delegate-task, review-delegated, adr,
                           clean-code, ui-ux, progress, setup, commit
agents/                    security-reviewer, test-writer, ux-reviewer, perf-reviewer
hooks/                     hooks.json + session-start, guard, no-ai (Node)
lib/                       progress, config, ai-terms, registry (shared by everything below)
cli/solo-keel.mjs               init, progress, check-ai, git-hooks, projects, serve, mcp
mcp/server.mjs             MCP stdio server
server/                    HTTP API + multi-project dashboard
templates/                 progress page, plan, ADR, git hooks
test/                      node:test
```

## Steps (each verified by `npm test` plus the listed check)

1. [lead] `lib/progress` and `lib/ai-terms` with tests first (compute, validate, set status, scan text/patches).
2. [lead] Rules and skills ported from the FlowForge kit, generalized (no product specifics).
3. [lead] Hooks: session-start, guard, no-ai; tests feed recorded hook payloads from both tools.
4. [lead] CLI: `init` (writes `.solo-keel.json`, progress file, optional git hooks; merges, never overwrites), `progress`, `check-ai`, `projects`.
5. [lead] MCP server with tools `progress_summary`, `progress_list`, `progress_set_status`, `progress_add_step`, `rules_get`; protocol test over stdio.
6. [lead] HTTP server: REST + dashboard (the progress page with a project switcher); localhost only, Host/Origin checks on every request.
7. [lead] Manifests, marketplace entries (pinned), README, API docs.
8. [lead] Review: security pass on server/MCP/hooks; install into a scratch project; validate plugin manifests.

## Risks

- Plugin hook trust: Codex asks the user to trust plugin hooks once; documented in README.
- Rule duplication in projects that already have the same rules in `CLAUDE.md` (like FlowForge): harmless, and `.solo-keel.json` can turn modules off.
- The HTTP server writes project files: bound to 127.0.0.1, checks Host and Origin, writes only to registered progress files, validates every change against the schema.

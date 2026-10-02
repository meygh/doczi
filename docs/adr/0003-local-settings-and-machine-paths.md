# 0003. Settings for one machine, and a check for machine paths in shared files

- Status: Proposed
- Date: 2026-10-02
- Requirements: none (found while two people used one project from different drives)

## Context

A project is checked out on different drives and folders. doczi already keeps the absolute
project path out of the repository (`~/.doczi/projects.json`), but nothing stopped a shared
file from naming one checkout's path, and there was no place for a value that really is
per-machine (a tool path, a proxy). Two people also ran `doczi init` on branches that already
had `.doczi.json`, which produced add/add merge conflicts.

## Options

1. **`.doczi.local.json` plus a check.** A git-ignored file next to `.doczi.json` for per-machine
   values; the edit hook blocks this machine's own paths in shared files; a CLI command scans
   tracked files; `init` refuses to duplicate files the upstream already has.
2. **Convention only.** A rule in `rules/core.md`, no tooling. Nothing catches a slip.
3. **Environment variables.** Per-machine values in `DOCZI_*` variables. Hard to document for a
   team and invisible to the agent.

## Decision

Option 1.

- `.doczi.local.json` holds `check` and `notes`; it is read with a size limit and never through
  a link, and a broken file is ignored and reported at session start.
- `lib/machine-paths.mjs` finds the project root and home folder of the current machine in every
  spelling (`E:\x`, `E:/x`, `/e/x`, JSON-escaped). The edit hook blocks them in shared files;
  `doczi check-paths` reports them as errors and any other absolute path as a warning.
  `.doczi.json → localPaths` switches it off or exempts files.
- `doczi init` adds the local file to `.gitignore` and stops when the upstream branch already
  has the config or progress file this checkout lacks.

## Consequences

- **Positive:** a colleague's checkout never sees another machine's paths; per-machine values
  have a home and reach the agent.
- **Negative:** a colleague's path typed by hand is only a warning, because it can not be told
  from an example; the upstream check reads the last fetched ref, not the server.
- **Follow-ups:** none. The HTTP API and the PHP and Python servers are unchanged.

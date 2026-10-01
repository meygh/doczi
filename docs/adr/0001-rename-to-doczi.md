# 0001. Rename solo-keel to doczi, with a legacy fallback until v0.3

- Status: Proposed
- Date: 2026-10-01
- Requirements: none (product decision); plan: [rename-doczi](../plans/rename-doczi.md)

## Context

The product needs a short, unique name before its first npm release. `doczi` is free on npm;
`solo-keel` is long and was itself a rename of `keel` (`b9c28c7`).

The name is part of several public contracts:

- the npm package and the CLI binary;
- the plugin, marketplace and MCP server names, and the skill prefix (`/solo-keel:<skill>`);
- the per-project config file (`.solo-keel.json`);
- the registry home (`~/.solo-keel`);
- the environment variables `SOLO_KEEL_HOME`, `SOLO_KEEL_PORT`, `SOLO_KEEL_LOCK_TIMEOUT_MS` and
  `SOLO_KEEL_DEBUG`.

These are read in `lib/config.mjs`, `lib/edit-check.mjs`, `lib/registry.mjs`, `lib/lock.mjs`,
`hooks/lib.mjs`, `cli/`, the `serve` launchers, `server/php/router.php`,
`server/python/server.py` and the standalone commit-msg hook. The keel → solo-keel rename had
no migration path, so every project broke until someone renamed its files by hand.

## Options

1. **Rename, and read the old names until v0.3.** New names everywhere. Where a new name is
   missing, the config lookup, registry home and environment variables fall back to the
   `solo-keel` ones, and the session-start text asks the user to run `doczi migrate`.
2. **Clean break, like `b9c28c7`.** Simplest code, but every existing project and installed
   git hook silently loses its settings.
3. **Do nothing.** Keep `solo-keel`. No migration work, but the long name stays and leaks into
   every project's file tree.

## Decision

Option 1.

- The new name always wins when both exist.
- The fallback lives in one module on Node (`lib/names.mjs`) and in one block of constants
  in each of the PHP and Python servers.
- The fallback is removed in v0.3.

## Consequences

- **Positive:**
  - Existing projects keep their rules, guard rails and dashboard entry across the upgrade.
  - Moving over is one command.
- **Negative:**
  - Two names stay in the code for two minor versions.
  - The fallback has to be kept in step across three servers.
  - Installed plugins still have to switch marketplaces by hand: plugin managers have no
    rename.
- **Follow-ups:**
  - v0.2 progress step "Remove the solo-keel fallback names (v0.3)".
  - The maintainer renames the GitHub repository and publishes to npm.

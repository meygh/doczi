# Plan: rename solo-keel to doczi

Status: implemented, awaiting review · Milestone: v0.1 · Requirements: none (product decision by the maintainer)

## Goal

One short, unique name everywhere: npm package, CLI, plugin and marketplace, skill prefix, MCP
server, config file, environment variables and docs. Unlike the keel → solo-keel rename
(`b9c28c7`), existing projects keep working: the old config file, home folder and environment
variables are still read, with a notice, until `doczi migrate` moves them.

## Acceptance criteria (testable)

1. `package.json` is named `doczi` and installs a `doczi` binary (`cli/doczi.mjs`); `doczi help`
   prints no "solo-keel".
2. Plugin, marketplace, MCP server and skill namespace are `doczi` (`/doczi:plan-feature`) in
   `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/` and `.mcp.json`.
3. `doczi init` writes `.doczi.json`; the config, the registry (`~/.doczi/projects.json`) and the
   environment variables (`DOCZI_HOME`, `DOCZI_PORT`, `DOCZI_LOCK_TIMEOUT_MS`, `DOCZI_DEBUG`) use
   the new name.
4. A project that has only `.solo-keel.json` is still found and read by the hooks, CLI, MCP
   server and all three HTTP servers, and the session-start text says once:
   `Rename .solo-keel.json to .doczi.json (run "doczi migrate").`
5. When `.doczi.json` and `.solo-keel.json` both exist, `.doczi.json` wins.
6. With no `~/.doczi/projects.json`, `~/.solo-keel/projects.json` is read (Node, PHP, Python).
   `SOLO_KEEL_*` variables apply only when the matching `DOCZI_*` one is unset.
7. `doczi migrate [dir]` renames `.solo-keel.json` to `.doczi.json` and copies the registry to
   `~/.doczi/`. If the target already exists, it refuses and changes nothing.
8. `doczi git-hooks` replaces a hook marked `solo-keel-managed` and removes the old
   `solo-keel-commit-msg.cjs`. A hook the user wrote themselves is still kept, with the same
   message as today.
9. Outside the legacy-fallback code, its tests, the ADR and the upgrade note,
   `grep -ri "solo-keel\|solo_keel\|keel"` finds nothing.
10. `npm run check` passes, and the HTTP contract suite passes against Node, PHP and Python.

## What I read

- `README.md`, `docs/PLAN.md`, `docs/plans/storage.md`, `package.json`, `.solo-keel.json`,
  `docs/progress/milestones.json`
- `lib/config.mjs` (`findRoot` and `loadConfig` are the only places that look up the config
  file name)
- The diff stat of `b9c28c7`: the earlier rename touched 55 files and had no migration path.
- Every line that mentions keel (158 × `solo-keel`, 47 × `.solo-keel.json`, 22 × `/solo-keel:`),
  in `lib/`, `hooks/`, `mcp/`, `server/{node,php,python}`, `cli/`, `templates/`, `web/`, the
  `serve` launchers and the manifests
- Internal identifiers that follow the name: the `KEEL` constant (cli), `keelHome()` (PHP),
  `solo_keel_home()` (Python), `$keelHome` (serve.ps1), `window.keelMarkdown` (web), the
  `solo-keel-managed` hook marker, and the temp-dir prefixes in tests

## Invariants touched

- **One contract, three servers.** The PHP and Python servers read the config and the registry
  themselves, so they need the same fallback. The HTTP API shape does not change, but
  `docs/API.md` changes its wording.
- **Never overwrite user files.** `migrate` and `git-hooks` refuse rather than clobber.
- **Hooks never break a session.** A legacy config produces a notice, never an error.
- **No dependencies:** unchanged.

## Design

- **`lib/names.mjs`** (new) is the single source of every name: `CONFIG_FILE = ".doczi.json"`,
  `LEGACY_CONFIG_FILES = [".solo-keel.json"]`, `HOME_DIR = ".doczi"`, `LEGACY_HOME_DIRS`, and
  `env(name)`, which reads `DOCZI_<name>` and falls back to `SOLO_KEEL_<name>`.
  - `config.mjs`, `edit-check.mjs`, `registry.mjs`, `lock.mjs`, `hooks/lib.mjs`, the CLI and the
    Node server import it.
  - PHP and Python have no shared code with Node, so each mirrors it in one small block of
    constants.
- **`configPath(root)`** returns `{ file, legacy }`. `loadConfig` sets `config.legacyFile` when
  it fell back, and session-start prints the notice from that.
- **`commit-msg` hook script** (`templates/git-hooks/doczi-commit-msg.cjs`): it is standalone, so
  it carries its own copy of the two file names.
- **Fallback lifetime.** The legacy names are read until v0.3. The ADR records that date, and
  removing the fallback is a progress step under v0.2.
- **Outside the repository** (maintainer only):
  - rename the GitHub repo `meygh/solo-keel` → `meygh/doczi` (GitHub redirects the old URLs);
  - publish `doczi` to npm;
  - users switch marketplaces with `/plugin marketplace remove solo-keel`, then
    `/plugin marketplace add meygh/doczi`.

## Test plan

- **Unit** (`project.test.mjs`, `lock.test.mjs`):
  - config lookup: new only, legacy only, both;
  - environment variables: new only, legacy only, both;
  - registry home fallback.
- **CLI** (`cli.test.mjs`):
  - `init` writes `.doczi.json`;
  - `migrate` renames, refuses when the target exists, and is a no-op on a migrated project;
  - `git-hooks` replaces a legacy managed hook and keeps a user hook.
- **Hooks** (`hooks.test.mjs`):
  - the session-start notice appears for a legacy config and not for a migrated one;
  - Claude Code and Codex payloads still work.
- **Contract** (`http-contract.test.mjs`): run against all three servers, once with a
  legacy-config project and once with a legacy registry home.
- **Package** (`package.test.mjs`): the `bin` entry is `doczi`; the npm `files` list includes
  `cli/doczi.mjs` and the new hook template.
- **Scan**: a test that greps the repo for leftover old names outside an allow-list
  (acceptance criterion 9).
- **Manual**: install from a local clone in Claude Code and in Codex, run `/doczi:progress` in a
  project that still has `.solo-keel.json`, then run `doczi migrate`.

## Steps
Each step is one commit and starts with the failing test.

1. ✅ **[lead]** ADR: the rename, the legacy fallback and its removal in v0.3. Verify: review.
2. ✅ **[lead]** `refactor!: rename solo-keel to doczi`. A mechanical rename across all 60 files,
   including the identifiers listed above and `git mv` for `cli/doczi.mjs`, the hook template
   and `.doczi.json`. Tests are updated to the new names, and the leftover-name scan test is
   added. Verify: `npm run check`, then the contract suite on PHP and Python.
3. ✅ **[lead]** `feat: read legacy solo-keel config, home and env`. `lib/names.mjs`, the Node
   fallback, the PHP and Python mirrors and the session-start notice; tests first. Verify:
   `npm run check` with php and python on PATH.
4. ✅ **[lead]** `feat(cli): doczi migrate`, plus `git-hooks` replacing legacy managed hooks;
   tests first. Verify: `npm run check`.
5. ✅ **[delegable, done by lead]** `docs: upgrade guide`. Add an "Upgrading from solo-keel" section to the
   README and the new names to `docs/API.md`. Verify: `npm run check` (AI scan) and review.
6. **[lead]** Manual install check in Claude Code and Codex from a local clone (the existing
   v0.1 steps). Verify: the checklist in the test plan.

## Progress steps

Under v0.1 → a new task "Rename to doczi": one step for each of steps 1–5. Under v0.2: the step
"Remove the solo-keel fallback names".

## Risks

- **The rename can't be split.** Every reference has to change in one commit, or the tests
  fail between commits. Step 2 is large but mechanical; review it by its diff stat and the
  scan test.
- **Installed plugins break until users switch marketplaces.** The upgrade note covers this,
  and the users today are the maintainer's own projects.
- **Old `solo-keel-commit-msg.cjs` hooks stay in projects** until `doczi git-hooks` runs again.
  They read `.solo-keel.json`. After `migrate`, they find no config and fall back to
  defaults (check on), which is safe.
- **The `.idea/` files reference `keel.iml`.** They are IDE files, so the rename leaves them
  alone.

## Open questions

1. Keep the legacy fallback until v0.3 (proposed), or make a clean break like last time?
2. Should the progress file's title change to "doczi: where we are"? (Proposed: yes.)

## ADR

Needed. The config file name, the CLI name and the environment variables are public contracts,
and the plan adds a deprecation window.

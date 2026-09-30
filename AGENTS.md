# Working on keel

keel's own rules apply here too (`rules/`), plus these:

- **No dependencies.** Node.js ≥ 20 standard library only, in every script, hook and server.
  PHP (≥ 8.1) and Python (≥ 3.9) servers use only what ships with the language. Plugins are
  cloned, not installed, so a dependency would break every user.
- **One contract, three servers.** Any change to the HTTP API changes `docs/API.md`,
  `test/http-contract.test.mjs` and all three servers (`server/node`, `server/php`,
  `server/python`) in the same commit. The suite runs against each installed runtime.
- **One core.** Progress rules live in `lib/progress.mjs`; the page (`web/app.js`) and the PHP
  and Python servers mirror only what they need (status values, one-step-per-line format).
  Keep them in step; tests check the file format from every server.
- **Hooks never break a session.** Every hook body runs inside `guarded()`; only a deliberate
  block exits with code 2. Hooks must work with Claude Code and Codex payloads (see
  `test/hooks.test.mjs`).
- **Never overwrite user files.** `keel init`, `keel git-hooks` and anything that writes into a
  project keeps existing files and says so.
- **Generic only.** No project-specific names, stacks or paths in rules, skills or agents.
  Projects add their own on top.
- **Check:** `npm run check` (tests plus the AI-mention scan of this repo) must pass.
- Commits: Conventional Commits, no assistant attribution. The maintainer pushes.

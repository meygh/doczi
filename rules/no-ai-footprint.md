# No AI footprint

Write everything as the project's own work. Never mention an AI tool, model or vendor
(assistant names, their companies, "generated with …", co-author trailers for assistants,
robot-emoji signatures) in:

- code, identifiers, file names, comments, docstrings, test names, fixtures;
- commit messages, tags, PR titles and bodies, changelogs, release notes;
- `Co-Authored-By` or any other trailer.

Exceptions: files whose job is to configure those tools (`CLAUDE.md`, `AGENTS.md`,
`.claude/`, `.codex/`, `.agents/`, plugin manifests, `.mcp.json`) and any paths the project lists
in `.doczi.json` → `aiFootprint.allow` (for example a provider adapter that must call a vendor
API).

doczi's hooks block edits and commit commands that break this, and `doczi git-hooks` installs a
`commit-msg` hook that strips attribution trailers. If a hook blocks you, rewrite the text
neutrally; do not work around the hook.

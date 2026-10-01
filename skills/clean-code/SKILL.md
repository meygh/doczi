---
name: clean-code
description: Review a diff, file or folder against the clean-code rules and fix what is in scope — naming, size, simplicity, error handling, bounds, tests. Use when asked to review or tidy code, or before finishing a change.
argument-hint: "[path, 'staged' or 'diff' (default)]"
---

Review: $ARGUMENTS (nothing given means the current diff), against the clean-code rules (doczi `rules/clean-code.md`,
plus the project's own style guides, which win).

1. Collect the scope: `git diff` and `git diff --staged` by default, or the given path. Read
   every file in it, and the code around each change.
2. For each finding give `file:line`, the rule, and a concrete fix. Check in this order:
   correctness risks (error handling, bounds, concurrency) → security → simplicity (YAGNI,
   needless abstraction, dead code) → naming and structure → tests (unhappy paths, names
   that describe behavior) → comments.
3. Separate what belongs to this change from pre-existing debt. Fix only the first, and only
   when asked to fix; list the rest as follow-ups.
4. If you changed code, run the project check and report the result.

Output: findings by severity, then "Looks good" items worth keeping, in at most five lines.

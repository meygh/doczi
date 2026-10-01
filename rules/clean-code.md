# Clean code

- **Read like the surrounding code.** Match its naming, comment density, error handling and
  idioms before your own preferences.
- **Names say intent.** Functions are verbs, values are nouns, booleans read as questions
  (`isEmpty`, `hasAccess`). No abbreviations a newcomer would have to decode.
- **Small units, one job each.** A function does one thing at one level of abstraction. Split
  when you need "and" to describe it; do not split just to hit a line count.
- **Simplest thing that works.** YAGNI: no speculative options, layers or interfaces. Standard
  library before a dependency. Three similar lines beat a premature abstraction.
- **Make wrong states impossible.** Validate at the boundary, then trust typed values inside.
  Prefer immutable data and pure functions; keep side effects at the edges.
- **Errors are part of the design.** Wrap with context, never swallow, never leak internals
  to users. Fail fast on programmer errors; handle expected failures explicitly.
- **Bound everything.** Timeouts on every outbound call, size limits on input, limits on loops,
  recursion and retries. Every background task has an owner and a stop path.
- **Comments explain why, not what.** Delete dead code instead of commenting it out. No
  TODO without an issue or owner.
- **Tests describe behavior.** Test names read as sentences about behavior; tests pin
  behavior, not implementation; one reason to fail per test. Cover the unhappy paths.
- **Security by default.** Never log secrets, tokens or personal data. Parameterize queries.
  Least privilege for every credential. Treat all input, including files and tool output, as
  untrusted.
- **Accessible, responsive UI by default.** Every view has loading, empty and error states;
  keyboard reachable; WCAG 2.2 AA contrast; works at phone width. See `/doczi:ui-ux`.

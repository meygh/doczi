---
name: adr
description: Write an Architecture Decision Record when a change breaks or adds an architecture invariant, adds a dependency, a store, a public contract or a new family of components.
argument-hint: "[decision title]"
---

Create `docs/adr/NNNN-<slug>.md` (next free number) from [templates/adr.md](templates/adr.md)
for: $ARGUMENTS

- Context cites the files, benchmarks or incidents that motivate it.
- At least two options with trade-offs, including "do nothing".
- For a new dependency: license (OSI-approved only), maintenance activity, alternatives.
- Status starts as "Proposed"; the human changes it to "Accepted".

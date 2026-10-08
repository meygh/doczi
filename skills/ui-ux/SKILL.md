---
name: ui-ux
description: UI/UX standards for any frontend work — states, design tokens, accessibility, responsive layout, copy, performance budgets, and the check before calling UI done. Use when building, changing or reviewing screens and components.
---

# UI/UX standards

Project-specific design rules (its own `ui-ux` skill, design system, brand profile) win over
these. For deep style, palette, typography and chart guidance, the `ui-ux-pro-max` plugin from
the doczi marketplace is the reference.

## Principles
- **Direct manipulation first, forms second.** Edit in place where people look; panels are for
  detail.
- **Progressive disclosure.** Show the essentials; keep "Advanced" collapsed.
- **Never lose work.** Autosave with visible status (Saving… / Saved / Offline), undo for
  every edit, confirm only destructive actions.
- **Fast feedback.** Validate as people type (debounced), next to the field, plus one list of
  all problems where the task is long.

## Every view has
- **Loading:** skeletons shaped like the result; no layout shift; no spinner for long waits.
- **Empty:** what this is, and the primary action to fill it.
- **Error:** what happened, what to do, retry; technical details collapsed.
- **Success:** optimistic updates for small edits, rolled back with a message on failure.

## Visual system
- Design tokens only (color, spacing scale, radius, type, shadow); no raw hex or one-off
  sizes.
- Light and dark themes both designed and tested; the user can choose, the default follows
  the system.
- One accent for primary actions; status colors only for status.

## Accessibility (WCAG 2.2 AA)
- Everything reachable and usable by keyboard, with a visible focus ring.
- Text contrast ≥ 4.5:1; targets ≥ 24 px (44 px on touch); respect reduced motion.
- A label for every input; errors linked with `aria-describedby`; required marked in text.

## Responsive
- Mobile first; test at 360, 768, 1024, 1280, 1440 and 1920 px, in light and dark, on every
  affected page and not only the block that changed. No horizontal page scroll.
- Measure block edges against the page's main width instead of judging by eye.
- Tables become cards on phones; dialogs become full-screen sheets; no hover-only actions.

## Copy
- Sentence case. Buttons are verbs ("Publish flow", not "OK"). Errors give cause and fix.
- Strings go through the project's i18n; never build sentences by concatenation.

## Performance
- Largest contentful paint ≤ 2.5 s on a mid-range phone; split heavy editors out of the first
  load; virtualize long lists; memoize expensive rows and nodes.

## Before done
- Stories or examples for new components in every state; component tests by role and label;
  an end-to-end test for new flows.
- Run the `ux-reviewer` agent, or the environment's own code review tool when there are no
  reviewer agents. If a browser tool is available, open the changed screens, check light and
  dark at the widths above, and do a keyboard-only pass.

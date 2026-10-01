---
name: import-tasks
description: Turn a requirements document, plan or checklist (SRS, PLAN, specs) into milestones, tasks and steps in the project's progress file, each task linked to its section. Shows the proposal first and writes only after the user agrees. Use when the user asks to import, extract or create tasks from documents.
argument-hint: "<document> [more documents] [--milestone <id>] [--language <language>]"
---

Import tasks from: $ARGUMENTS

The progress file is the project's (`.doczi.json` → `progress`). Never write it by hand. Use the
doczi MCP tool `progress_import`, or `doczi import` when the tool is not available.

1. **Read the documents in full.** Note:
   - their requirement IDs (`FR-12`, `PAY-4`, …);
   - their headings;
   - any milestones or phases they already define;
   - their acceptance or exit criteria.

   Read the current progress file too (`progress_list`), so nothing is proposed twice.
2. **Checklists already?** Some documents already list work as `- [ ]` items under headings.
   For those, call `progress_import` with `file`, `milestone` (and `name` for a new
   milestone). Leave `apply` out. Go to step 5.
3. **Otherwise, build a plan.** Use the shape
   `{ "milestones": [{ "id", "name", "when?", "exit?", "tasks": [{ "name", "type?", "tags?", "docs?", "steps": [{ "title" }] }] }] }`.
   - **Milestones:** the document's own phases if it has them. Otherwise one per delivery stage
     (foundation first, launch last), each with an `exit` that someone can check.
   - **Tasks:** one per coherent piece of work. Link each task to its section with
     `"docs": [{ "title": "<ID or heading>", "path": "<doc>#<anchor>" }]`. To make the anchor:
     1. Take the heading text and lower-case it.
     2. Keep letters, digits, spaces and hyphens; drop everything else.
     3. Turn spaces into hyphens.
     4. If the same heading appears again, add `-1` to the second one, `-2` to the third, and so
        on.

     `### PAY: Payments` becomes `#pay-payments`.
   - **Steps:** small outcomes that can be checked, each a few hours to two days of work.
     Name the requirement IDs a step covers in its title (`Lock the rate for the window
     (PAY-4)`).
   - **Type and tags:**
     - The type is `feature`, `bug`, `issue`, `refinement`, `redesign`, `chore`, `docs`,
       `research` or `security`.
     - Tags are lower case with no spaces. A requirement prefix makes a good tag (`pay`).
   - **Language:** write names and titles in the language the user asked for, default English.
     Keep technical terms, code names and IDs in English.
   - **Decisions the documents leave open** stay out of the steps. List them for step 6.
4. **Preview:** call `progress_import` with the `plan` and no `apply`.
5. **Show the user:**
   - the preview;
   - which requirement IDs each milestone covers;
   - any requirement no step covers (there should be none).

   Ask whether to add it, change it, or leave it. Stop here until they answer.
6. **Apply only after a clear yes.** Call `progress_import` again with `apply: true`. Then record
   each open decision as a question on its task (`progress_ask`). Existing milestones, tasks and
   steps are matched and never changed.
7. **Report:**
   - what was added;
   - the questions you recorded;
   - the `doczi progress` summary line.

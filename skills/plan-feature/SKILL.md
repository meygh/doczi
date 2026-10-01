---
name: plan-feature
description: Write a reviewed implementation plan for a feature, milestone task or any change touching more than two files or a public contract, before any code is written.
argument-hint: "[task, milestone step or feature description]"
---

Plan: $ARGUMENTS

1. Find the task in the project's requirements and progress file (`.doczi.json` → `progress`,
   usually `docs/progress/milestones.json`): milestone, requirement IDs, exit criterion. If it
   is not there, say so.
2. Read the code that will change. Do not guess; list what you read.
3. Write `docs/plans/<slug>.md` from [templates/plan.md](templates/plan.md):
   - goal, requirement IDs, acceptance criteria as testable statements;
   - affected files and the project invariants they touch;
   - design: data model, contract changes, sequence of calls;
   - test plan: unit, integration, end-to-end, benchmarks, security tests;
   - steps: ordered, one commit each, each with its verification command, each tagged
     `[lead]` or `[delegable]` (see the delegation rule);
   - risks, open questions, and whether an ADR is needed (`/doczi:adr`);
   - new progress steps to add, if the tracker does not have them yet.
4. Stop and ask for approval of the plan and of the delegation split (list each
   `[delegable]` step with a one-line reason). Write no code in this skill.

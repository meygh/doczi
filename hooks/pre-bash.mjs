#!/usr/bin/env node
// PreToolUse on shell commands: block commit, tag and PR text that mentions AI tools, and
// check patches applied through the shell like direct edits.
import { block, guarded, project, readInput } from "./lib.mjs";
import { commitTextOf, patchesIn, scanText } from "../lib/ai-terms.mjs";
import { AI_RULE, changesFromPatches, checkChanges } from "../lib/edit-check.mjs";

guarded(() => {
  const input = readInput();
  if (!input) process.exit(0);
  const ctx = project(input);
  const command = input.tool_input?.command ?? input.tool_input?.cmd;

  const patches = patchesIn(command);
  if (patches.length) {
    const problems = checkChanges(changesFromPatches(patches, input.cwd || process.cwd()), ctx);
    if (problems.length) block(["doczi blocked this patch:", ...problems.map((p) => `- ${p}`), ...(problems.some((p) => p.includes(" line ")) ? [AI_RULE] : [])]);
  }

  if (!ctx.config?.aiFootprint.check) process.exit(0);
  const text = commitTextOf(command);
  if (!text) process.exit(0);
  // Scan the whole command as one block so multi-line messages and trailers are caught.
  const hits = scanText(text.replace(/\\n/g, "\n"), ctx.config.aiFootprint.terms);
  if (hits.length) {
    block([
      "doczi blocked this command: commit, tag and PR text must not mention AI tools, vendors or assistant co-authors.",
      ...hits.map((h) => `- ${h.text}`),
      "Remove those parts and run it again.",
    ]);
  }
});

#!/usr/bin/env node
// PreToolUse on edits (Claude Code: Write, Edit, MultiEdit; Codex: apply_patch).
// Blocks writes to protected files and new text that mentions AI tools.
// This prevents accidents; it is not a sandbox (shell commands can still write files).
import path from "node:path";
import { block, guarded, project, readInput } from "./lib.mjs";
import { patchesIn } from "../lib/ai-terms.mjs";
import { AI_RULE, changesFromPatches, checkChanges } from "../lib/edit-check.mjs";

function changes(input) {
  const t = input.tool_input ?? {};
  const cwd = input.cwd || process.cwd();
  const patches = [t, t.command, t.input, t.patch].flatMap(patchesIn);
  if (patches.length) return changesFromPatches(patches, cwd);
  if (typeof t.file_path !== "string") return [];
  const text = [t.content, t.new_string, ...(Array.isArray(t.edits) ? t.edits.map((e) => e?.new_string) : [])]
    .filter((v) => typeof v === "string").join("\n");
  return [{ file: path.resolve(cwd, t.file_path), text }];
}

guarded(() => {
  const input = readInput();
  if (!input) process.exit(0);
  const ctx = project(input);
  const problems = checkChanges(changes(input), ctx);
  if (problems.length) {
    block(["solo-keel blocked this edit:", ...problems.map((p) => `- ${p}`), ...(problems.some((p) => p.includes(" line ")) ? [AI_RULE] : [])]);
  }
});

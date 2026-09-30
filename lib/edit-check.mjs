// What an edit would change, and whether keel's rules allow it. Shared by the edit and shell hooks.
import fs from "node:fs";
import path from "node:path";
import { addedLinesFromPatch, filesInPatch, isAllowed, normalizePath, relativeTo, scanText } from "./ai-terms.mjs";
import { matchesAny } from "./config.mjs";

// Real path of p, resolving symlinks in the part that exists.
export function realPath(p) {
  let head = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) break;
    tail.unshift(path.basename(head));
    head = up;
  }
  try { head = fs.realpathSync.native(head); } catch { /* keep as is */ }
  return path.join(head, ...tail);
}

// [{ file (absolute), text (added text) }] from a patch.
export function changesFromPatch(patch, cwd) {
  const byFile = new Map(filesInPatch(patch).map((f) => [f, []]));
  for (const { file, text } of addedLinesFromPatch(patch)) byFile.set(file, (byFile.get(file) || []).concat(text));
  return [...byFile].map(([file, lines]) => ({ file: path.resolve(cwd, file), text: lines.join("\n") }));
}

// → list of human-readable problems (empty when the edit is fine).
export function checkChanges(changes, { root, config }) {
  const problems = [];
  const realRoot = realPath(root);
  for (const { file, text } of changes) {
    // Strip Windows aliases (\\?\, streams) before resolving, then compare real paths.
    const cleaned = normalizePath(file);
    const real = realPath(/^[a-z]:\//.test(cleaned) || cleaned.startsWith("/") ? cleaned : file);
    const rel = relativeTo(real, realRoot) ?? relativeTo(cleaned, root);
    if (rel === null) continue; // other repos have their own rules
    if (matchesAny(rel, config.protect)) {
      problems.push(`${rel} is protected (.keel.json → protect): generated or secret. Change its source or ask the user.`);
      continue;
    }
    if (!config.aiFootprint.check || isAllowed(real, realRoot, config.aiFootprint.allow)) continue;
    for (const hit of scanText(text, config.aiFootprint.terms)) problems.push(`${rel} line ${hit.line} of the new text: ${hit.text}`);
  }
  return problems;
}

export const AI_RULE = "Rule: no AI tool, model or vendor names or attribution in project files. Rewrite neutrally.";

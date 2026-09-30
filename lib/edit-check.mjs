// What an edit would change, and whether keel's rules allow it. Shared by the edit and shell hooks.
import fs from "node:fs";
import path from "node:path";
import { addedLinesFromPatch, DEFAULT_ALLOW, filesInPatch, isAllowed, normalizePath, relativeTo, scanText } from "./ai-terms.mjs";
import { DEFAULT_CONFIG, findRoot, loadConfig, matchesAny } from "./config.mjs";

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

// [{ file (absolute), text (added text) }] from one or more patches.
export function changesFromPatches(patches, cwd) {
  const byFile = new Map();
  for (const patch of patches) {
    for (const f of filesInPatch(patch)) if (!byFile.has(f)) byFile.set(f, []);
    for (const { file, text } of addedLinesFromPatch(patch)) byFile.set(file, (byFile.get(file) || []).concat(text));
  }
  return [...byFile].map(([file, lines]) => ({ file: path.resolve(cwd, file), text: lines.join("\n") }));
}

// A project's config; a broken .keel.json falls back to the defaults (all checks on).
function configFor(root) {
  try { return loadConfig(root); }
  catch { return { ...DEFAULT_CONFIG, name: path.basename(root), aiFootprint: { ...DEFAULT_CONFIG.aiFootprint, allow: [...DEFAULT_ALLOW] } }; }
}

const isProject = (dir) => fs.existsSync(path.join(dir, ".keel.json")) || fs.existsSync(path.join(dir, ".git"));

function problemsFor(real, cleaned, root, config, text) {
  const realRoot = realPath(root);
  const rel = relativeTo(real, realRoot) ?? relativeTo(cleaned, root);
  if (rel === null) return [];
  if (matchesAny(rel, config.protect)) return [`${rel} is protected (.keel.json → protect): generated or secret. Change its source or ask the user.`];
  if (!config.aiFootprint.check || isAllowed(real, realRoot, config.aiFootprint.allow)) return [];
  return scanText(text, config.aiFootprint.terms).map((hit) => `${rel} line ${hit.line} of the new text: ${hit.text}`);
}

// Each file is judged by its own project's rules and, when it lies inside the session's
// project, by that project's rules too: a nested repo cannot switch the checks off.
export function checkChanges(changes, session) {
  const problems = new Set();
  for (const { file, text } of changes) {
    // Strip Windows aliases (\\?\, streams, trailing dots) before resolving, then compare real paths.
    const cleaned = normalizePath(file);
    const real = realPath(/^[a-z]:\//.test(cleaned) || cleaned.startsWith("/") ? cleaned : file);
    const ownRoot = findRoot(path.dirname(real));
    if (isProject(ownRoot)) for (const p of problemsFor(real, cleaned, ownRoot, configFor(ownRoot), text)) problems.add(p);
    if (session?.config && path.resolve(ownRoot) !== path.resolve(session.root)) {
      for (const p of problemsFor(real, cleaned, session.root, session.config, text)) problems.add(p);
    }
  }
  return [...problems];
}

export const AI_RULE = "Rule: no AI tool, model or vendor names or attribution in project files. Rewrite neutrally.";

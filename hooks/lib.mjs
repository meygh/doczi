// Shared helpers for solo-keel's hooks. The same scripts run under Claude Code and Codex:
// both send JSON on stdin, both treat exit code 2 + stderr as "blocked, tell the agent why".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRoot, loadConfig } from "../lib/config.mjs";

export const pluginRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function readInput() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); }
  catch { return null; }
}

export function project(input) {
  const root = findRoot(input?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  let config = null, error = null;
  try { config = loadConfig(root); } catch (err) { error = err.message; }
  return { root, config, error };
}

export function block(lines) {
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}

// Run a hook body; a bug in solo-keel must never break the user's session.
export function guarded(fn) {
  try { fn(); }
  catch (err) {
    if (process.env.SOLO_KEEL_DEBUG) process.stderr.write(`solo-keel hook error: ${err.stack}\n`);
    process.exit(0);
  }
}

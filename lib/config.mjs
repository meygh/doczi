// Per-project settings in .solo-keel.json. Everything is optional; defaults suit most projects.
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_ALLOW } from "./ai-terms.mjs";

export const RULE_MODULES = ["core", "clean-code", "no-ai-footprint", "delegation"];

export const DEFAULT_CONFIG = {
  name: "",
  check: "",
  progress: "docs/progress/milestones.json",
  rules: RULE_MODULES,
  aiFootprint: { check: true, allow: [], terms: [] },
  protect: [".env", ".env.*", "*.pem", "*.key", "**/secrets/**"],
};

export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".solo-keel.json")) || fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

export function loadConfig(root) {
  const file = path.join(root, ".solo-keel.json");
  let own = {};
  if (fs.existsSync(file)) {
    try { own = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
    catch (err) { throw new Error(`${file} is not valid JSON (${err.message}).`); }
  }
  const ai = { ...DEFAULT_CONFIG.aiFootprint, ...(own.aiFootprint || {}) };
  return {
    ...DEFAULT_CONFIG,
    ...own,
    name: own.name || path.basename(root),
    rules: own.rules === false ? [] : Array.isArray(own.rules) ? own.rules : DEFAULT_CONFIG.rules,
    aiFootprint: { ...ai, allow: [...DEFAULT_ALLOW, ...(ai.allow || [])], terms: ai.terms || [] },
    protect: Array.isArray(own.protect) ? own.protect : DEFAULT_CONFIG.protect,
  };
}

// Minimal globs: "**" crosses folders, "*" does not. A pattern without "/" matches the file name anywhere.
function globToRegExp(glob) {
  const body = glob.split("**").map((part) =>
    part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
  return new RegExp(`^${body.replace(/^\.\*\//, "(?:.*/)?").replace(/\/\.\*$/, "(?:/.*)?")}$`, "i");
}

export function matchesAny(relPath, patterns) {
  const p = relPath.replace(/\\/g, "/");
  const name = p.split("/").pop();
  return patterns.some((g) => (g.includes("/") ? globToRegExp(g).test(p) : globToRegExp(g).test(name)));
}

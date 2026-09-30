// Registered projects, shared by the CLI, the HTTP API and the MCP server.
// Stored in $SOLO_KEEL_HOME/projects.json (default ~/.solo-keel).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./fsutil.mjs";

export const home = () => process.env.SOLO_KEEL_HOME || path.join(os.homedir(), ".solo-keel");
const file = () => path.join(home(), "projects.json");

function load() {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")).projects || []; }
  catch { return []; }
}

function save(projects) {
  fs.mkdirSync(home(), { recursive: true });
  writeFileAtomic(file(), JSON.stringify({ projects }, null, 2) + "\n");
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function list() {
  return load();
}

export function get(id) {
  return load().find((p) => p.id === id) || null;
}

export function register(dir, name = path.basename(path.resolve(dir))) {
  const projects = load();
  const existing = projects.find((p) => same(p.path, dir));
  if (existing) return existing;
  let id = slug(name);
  for (let n = 2; projects.some((p) => p.id === id); n++) id = `${slug(name)}-${n}`;
  const entry = { id, name, path: path.resolve(dir) };
  projects.push(entry);
  save(projects);
  return entry;
}

export function unregister(id) {
  const projects = load();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return false;
  save(next);
  return true;
}

// Registered projects, shared by the CLI, the HTTP API and the MCP server.
// Stored in $DOCZI_HOME/projects.json (default ~/.doczi); names.mjs has the legacy fallback.
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./fsutil.mjs";
import { home, registryFiles } from "./names.mjs";

export { home };
const file = () => path.join(home(), "projects.json");

function load() {
  const found = registryFiles().find((f) => fs.existsSync(f));
  if (!found) return [];
  try { return JSON.parse(fs.readFileSync(found, "utf8")).projects || []; }
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

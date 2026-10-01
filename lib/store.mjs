// Reads and writes a project's progress file. Every write is validated and atomic, and never
// follows a symlink out of the project (a registered repo may be hostile).
import fs from "node:fs";
import path from "node:path";
import { findRoot, loadConfig } from "./config.mjs";
import { get } from "./registry.mjs";
import { format, parse, validate } from "./progress.mjs";
import { writeFileAtomic } from "./fsutil.mjs";
import { withLockSync } from "./lock.mjs";

export { writeFileAtomic };

const within = (root, p) => {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

// Throws unless file (existing or not) really lies inside root and is not itself a symlink.
export function assertInside(root, file) {
  const outside = new Error(`The progress file must be inside the project (${file}).`);
  if (!within(path.resolve(root), path.resolve(file))) throw outside;
  const realRoot = fs.realpathSync.native(root);
  let dir = path.dirname(path.resolve(file));
  while (!fs.existsSync(dir)) dir = path.dirname(dir);
  const realDir = fs.realpathSync.native(dir);
  if (realDir !== realRoot && !within(realRoot, realDir)) throw outside;
  let stat = null;
  try { stat = fs.lstatSync(file); } catch { /* does not exist yet */ }
  if (stat?.isSymbolicLink()) throw new Error(`The progress file is a symbolic link; doczi does not follow it (${file}).`);
}

// ref: a registered project id, a path inside a project, or nothing (current folder).
export function openProject(ref) {
  const registered = ref ? get(ref) : null;
  const root = registered ? registered.path : findRoot(ref || process.cwd());
  const config = loadConfig(root);
  const progressPath = path.resolve(root, config.progress);
  if (!within(root, progressPath)) throw new Error(`"progress" in .doczi.json must point inside the project (${config.progress}).`);
  return { id: registered?.id || null, root, config, progressPath };
}

export function readProgress(project) {
  if (!fs.existsSync(project.progressPath)) throw new Error(`No progress file at ${project.progressPath}. Run "doczi init" to create one.`);
  assertInside(project.root, project.progressPath);
  const data = parse(fs.readFileSync(project.progressPath, "utf8"));
  const problems = validate(data);
  if (problems.length) throw new Error(`${project.progressPath}: ${problems.join(" ")}`);
  return data;
}

export function writeProgress(project, data) {
  const problems = validate(data);
  if (problems.length) throw new Error(problems.join(" "));
  assertInside(project.root, project.progressPath);
  fs.mkdirSync(path.dirname(project.progressPath), { recursive: true });
  assertInside(project.root, project.progressPath);
  writeFileAtomic(project.progressPath, format(data));
}

// Read, change, write under the file's lock — the change function returns what to report.
export function updateProgress(project, change) {
  assertInside(project.root, project.progressPath);
  return withLockSync(project.progressPath, () => {
    const data = readProgress(project);
    const result = change(data);
    writeProgress(project, data);
    return result;
  });
}

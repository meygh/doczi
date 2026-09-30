import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, findRoot, matchesAny, DEFAULT_CONFIG } from "../lib/config.mjs";
import { register, list, get, unregister } from "../lib/registry.mjs";
import { openProject, readProgress, writeProgress } from "../lib/store.mjs";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keel-"));
  process.env.KEEL_HOME = path.join(tmp, "home");
});

const mkProject = (name, config) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, "src", "deep"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"));
  if (config) fs.writeFileSync(path.join(dir, ".keel.json"), JSON.stringify(config));
  return dir;
};

test("findRoot walks up to the folder with .keel.json or .git", () => {
  const dir = mkProject("a");
  assert.equal(findRoot(path.join(dir, "src", "deep")), dir);
});

test("loadConfig fills defaults and keeps project settings", () => {
  const dir = mkProject("b", { name: "Bee", rules: ["core"], aiFootprint: { allow: ["vendor/"] } });
  const c = loadConfig(dir);
  assert.equal(c.name, "Bee");
  assert.deepEqual(c.rules, ["core"]);
  assert.equal(c.progress, DEFAULT_CONFIG.progress);
  assert.equal(c.aiFootprint.check, true);
  assert.ok(c.aiFootprint.allow.includes("vendor/"));
  assert.ok(c.aiFootprint.allow.includes("CLAUDE.md"));
});

test("loadConfig reports a broken .keel.json instead of guessing", () => {
  const dir = mkProject("c");
  fs.writeFileSync(path.join(dir, ".keel.json"), "{ nope");
  assert.throws(() => loadConfig(dir), /\.keel\.json/);
});

test("matchesAny understands ** and * globs", () => {
  assert.equal(matchesAny("backend/internal/gen/x.go", ["**/gen/**"]), true);
  assert.equal(matchesAny("a.pem", ["*.pem"]), true);
  assert.equal(matchesAny("dir/a.pem", ["*.pem"]), true);
  assert.equal(matchesAny("src/generate.go", ["**/gen/**"]), false);
});

test("registry registers once per path, gives readable ids and survives reloads", () => {
  const a = mkProject("My App");
  const b = mkProject("other");
  const first = register(a);
  assert.equal(first.id, "my-app");
  assert.equal(register(a).id, "my-app");
  assert.equal(register(b, "My App").id, "my-app-2");
  assert.deepEqual(list().map((p) => p.id), ["my-app", "my-app-2"]);
  assert.equal(get("my-app").path, a);
  unregister("my-app");
  assert.equal(get("my-app"), null);
});

test("store reads and writes the progress file, refusing invalid data", () => {
  const dir = mkProject("d", { progress: "plan/progress.json" });
  const project = openProject(dir);
  assert.equal(project.progressPath, path.join(dir, "plan", "progress.json"));
  assert.throws(() => readProgress(project), /No progress file/);
  writeProgress(project, { milestones: [{ id: "M0", name: "Start", tasks: [] }] });
  assert.equal(readProgress(project).milestones[0].id, "M0");
  assert.throws(() => writeProgress(project, { milestones: [{ id: "", tasks: [] }] }), /id/);
  assert.equal(readProgress(project).milestones[0].id, "M0");
});

test("openProject accepts a registered id or a path, and rejects a progress path outside the project", () => {
  const dir = mkProject("e");
  register(dir);
  assert.equal(openProject("e").root, dir);
  const evil = mkProject("f", { progress: "../e/steal.json" });
  assert.throws(() => openProject(evil), /inside the project/);
});

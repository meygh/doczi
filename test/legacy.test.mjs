// Projects set up before the rename keep working until v0.3: the solo-keel config file, home
// folder and environment variables are still read, and the new names always win
// (docs/adr/0001-rename-to-doczi.md).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, findRoot } from "../lib/config.mjs";
import { env } from "../lib/names.mjs";
import { list, register, home } from "../lib/registry.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const ENV_KEYS = ["DOCZI_HOME", "SOLO_KEEL_HOME", "DOCZI_PORT", "SOLO_KEEL_PORT", "HOME", "USERPROFILE"];
let tmp, saved;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-legacy-"));
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS.slice(0, 4)) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

const mkProject = (files) => {
  const dir = fs.mkdtempSync(path.join(tmp, "p-"));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(content));
  return dir;
};
const writeRegistry = (dir, projects) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify({ projects }));
};

test("a project with only .solo-keel.json is found and its settings are read", () => {
  const dir = mkProject({ ".solo-keel.json": { progress: "plan/p.json", rules: ["core"] } });
  fs.mkdirSync(path.join(dir, "src"));
  assert.equal(findRoot(path.join(dir, "src")), dir);
  const config = loadConfig(dir);
  assert.equal(config.progress, "plan/p.json");
  assert.deepEqual(config.rules, ["core"]);
  assert.equal(config.legacyFile, ".solo-keel.json");
});

test(".doczi.json wins over .solo-keel.json, and a migrated project has no legacy file", () => {
  const both = mkProject({ ".doczi.json": { progress: "new.json" }, ".solo-keel.json": { progress: "old.json" } });
  assert.equal(loadConfig(both).progress, "new.json");
  assert.equal(loadConfig(both).legacyFile, undefined);
});

test("SOLO_KEEL_* variables apply only when the DOCZI_* one is unset", () => {
  process.env.SOLO_KEEL_PORT = "4900";
  assert.equal(env("PORT"), "4900");
  process.env.DOCZI_PORT = "5000";
  assert.equal(env("PORT"), "5000");
  assert.equal(env("NOT_SET"), "");
});

test("the registry home follows DOCZI_HOME, then SOLO_KEEL_HOME, then ~/.doczi", () => {
  process.env.SOLO_KEEL_HOME = path.join(tmp, "old");
  assert.equal(home(), path.join(tmp, "old"));
  process.env.DOCZI_HOME = path.join(tmp, "new");
  assert.equal(home(), path.join(tmp, "new"));
});

test("with no ~/.doczi registry, ~/.solo-keel is read, and the next change lands in ~/.doczi", () => {
  process.env.HOME = process.env.USERPROFILE = tmp;
  const old = mkProject({});
  writeRegistry(path.join(tmp, ".solo-keel"), [{ id: "old", name: "Old", path: old }]);
  assert.deepEqual(list().map((p) => p.id), ["old"]);
  register(mkProject({}), "Fresh");
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, ".doczi", "projects.json"), "utf8"));
  assert.deepEqual(saved.projects.map((p) => p.id), ["old", "fresh"]);
  assert.ok(fs.existsSync(path.join(tmp, ".solo-keel", "projects.json")), "the old registry is left alone");
});

test("session-start asks once to migrate a legacy config, and says nothing for a migrated one", () => {
  const run = (dir) => {
    const r = spawnSync(process.execPath, [path.join(repo, "hooks/session-start.mjs")], { input: JSON.stringify({ cwd: dir }), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  };
  const notice = /Rename \.solo-keel\.json to \.doczi\.json \(run "doczi migrate"\)\./;
  assert.equal(run(mkProject({ ".solo-keel.json": { rules: ["core"] } })).match(new RegExp(notice, "g")).length, 1);
  assert.doesNotMatch(run(mkProject({ ".doczi.json": { rules: ["core"] } })), notice);
});

test("the standalone commit-msg hook still reads .solo-keel.json", () => {
  const dir = mkProject({ ".solo-keel.json": { aiFootprint: { check: false } } });
  spawnSync("git", ["init", "-q", dir]);
  const msg = path.join(dir, "MSG");
  fs.writeFileSync(msg, "feat: tuned by codex\n");
  const r = spawnSync(process.execPath, [path.join(repo, "templates/git-hooks/doczi-commit-msg.cjs"), msg], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

const cli = path.join(repo, "cli/doczi.mjs");
const runCli = (cwd, args, extraEnv = {}) => {
  const childEnv = { ...process.env, HOME: tmp, USERPROFILE: tmp, ...extraEnv };
  delete childEnv.DOCZI_HOME;
  delete childEnv.SOLO_KEEL_HOME;
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: childEnv, encoding: "utf8" });
};

test("migrate renames .solo-keel.json to .doczi.json and copies the legacy registry", () => {
  const dir = mkProject({ ".solo-keel.json": { progress: "plan/p.json" } });
  writeRegistry(path.join(tmp, ".solo-keel"), [{ id: "p", name: "P", path: dir }]);
  const r = runCli(dir, ["migrate"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, ".solo-keel.json")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".doczi.json"), "utf8")).progress, "plan/p.json");
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, ".doczi", "projects.json"), "utf8")).projects[0].id, "p");
  assert.ok(fs.existsSync(path.join(tmp, ".solo-keel", "projects.json")), "the old registry is left alone");
  const again = runCli(dir, ["migrate"]);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Nothing to migrate/);
});

test("migrate refuses and changes nothing when .doczi.json already exists", () => {
  const dir = mkProject({ ".doczi.json": { progress: "new.json" }, ".solo-keel.json": { progress: "old.json" } });
  const r = runCli(dir, ["migrate"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.doczi\.json already exists/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".doczi.json"), "utf8")).progress, "new.json");
  assert.ok(fs.existsSync(path.join(dir, ".solo-keel.json")));
});

test("migrate keeps an existing ~/.doczi registry", () => {
  const dir = mkProject({ ".solo-keel.json": {} });
  writeRegistry(path.join(tmp, ".solo-keel"), [{ id: "old", name: "Old", path: dir }]);
  writeRegistry(path.join(tmp, ".doczi"), [{ id: "new", name: "New", path: dir }]);
  assert.equal(runCli(dir, ["migrate"]).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, ".doczi", "projects.json"), "utf8")).projects[0].id, "new");
});

test("git-hooks replaces the hook solo-keel installed and removes its old script", () => {
  const dir = mkProject({});
  spawnSync("git", ["init", "-q", dir]);
  const hooksDir = path.join(dir, ".git", "hooks");
  fs.writeFileSync(path.join(hooksDir, "commit-msg"), '#!/bin/sh\n# solo-keel-managed commit-msg hook\nexec node "$(dirname "$0")/solo-keel-commit-msg.cjs" "$@"\n');
  fs.writeFileSync(path.join(hooksDir, "solo-keel-commit-msg.cjs"), "// old\n");
  const r = runCli(dir, ["git-hooks"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(hooksDir, "commit-msg"), "utf8"), /doczi-commit-msg\.cjs/);
  assert.equal(fs.existsSync(path.join(hooksDir, "solo-keel-commit-msg.cjs")), false);
});

test("once ~/.doczi exists, the legacy registry is no longer read", () => {
  process.env.HOME = process.env.USERPROFILE = tmp;
  writeRegistry(path.join(tmp, ".solo-keel"), [{ id: "removed", name: "Removed", path: tmp }]);
  fs.mkdirSync(path.join(tmp, ".doczi"));
  assert.deepEqual(list(), []);
});

test("a .doczi.json that is a folder is not taken for the config", () => {
  const dir = mkProject({ ".solo-keel.json": { progress: "old.json" } });
  fs.mkdirSync(path.join(dir, ".doczi.json"));
  assert.equal(loadConfig(dir).progress, "old.json");
});

const canSymlink = (() => {
  try { const d = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-ln-")); fs.symlinkSync(d, path.join(d, "l")); return true; } catch { return false; }
})();

test("migrate refuses a symlinked .solo-keel.json", { skip: canSymlink ? false : "symlinks need extra rights here" }, () => {
  const dir = mkProject({ "real.json": {} });
  fs.symlinkSync(path.join(dir, "real.json"), path.join(dir, ".solo-keel.json"));
  const r = runCli(dir, ["migrate"]);
  assert.equal(r.status, 1);
  assert.equal(fs.existsSync(path.join(dir, ".doczi.json")), false);
});

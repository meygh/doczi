import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { loadLocal } from "../lib/local.mjs";
import { foreignPathHits, ownPathHits, ownPaths } from "../lib/machine-paths.mjs";

const cli = fileURLToPath(new URL("../cli/doczi.mjs", import.meta.url));
const hooks = fileURLToPath(new URL("../hooks/", import.meta.url));
let tmp, dir, env;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-local-"));
  dir = path.join(tmp, "Shop");
  fs.mkdirSync(dir);
  spawnSync("git", ["init", "-q", dir]);
  fs.writeFileSync(path.join(dir, ".doczi.json"), JSON.stringify({ rules: ["core"], check: "make check" }));
  env = { ...process.env, DOCZI_HOME: path.join(tmp, "home") };
});

const write = (name, text) => fs.writeFileSync(path.join(dir, name), typeof text === "string" ? text : JSON.stringify(text));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: "utf8" });
const hook = (script, payload) => {
  const r = spawnSync(process.execPath, [path.join(hooks, script)], { input: JSON.stringify(payload), encoding: "utf8", env });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

// ---- .doczi.local.json ----

test("local settings override the check command and carry notes for this machine", () => {
  write(".doczi.local.json", { check: "php vendor/bin/phpunit", notes: ["git needs -c safe.directory here", "  "] });
  const config = loadConfig(dir);
  assert.equal(config.check, "php vendor/bin/phpunit");
  assert.deepEqual(config.localNotes, ["git needs -c safe.directory here"]);
});

test("without a local file the project config is used as it is", () => {
  const config = loadConfig(dir);
  assert.equal(config.check, "make check");
  assert.deepEqual(config.localNotes, []);
});

test("a broken or oversized local file is ignored and reported, never thrown", () => {
  write(".doczi.local.json", "{");
  assert.match(loadLocal(dir).error, /not valid JSON/);
  assert.equal(loadConfig(dir).check, "make check");
  write(".doczi.local.json", { notes: Array.from({ length: 40 }, (_, i) => `note ${i}`.padEnd(400, "x")) });
  const local = loadLocal(dir);
  assert.equal(local.notes.length, 20);
  assert.ok(local.notes.every((n) => n.length <= 300));
});

test("a local file that is a symbolic link is not read", { skip: process.platform === "win32" && "symlinks need rights on Windows" }, () => {
  const secret = path.join(tmp, "secret.json");
  fs.writeFileSync(secret, JSON.stringify({ notes: ["leaked"] }));
  fs.symlinkSync(secret, path.join(dir, ".doczi.local.json"));
  assert.deepEqual(loadLocal(dir).notes, []);
});

// ---- machine paths ----

test("a path of this machine is found in every spelling, and a sibling folder is not", () => {
  const paths = ownPaths("E:\\xampp\\htdocs\\sana-portal", "C:\\Users\\dev");
  for (const line of [
    "git -c safe.directory=E:/xampp/htdocs/sana-portal status",
    String.raw`"path": "E:\\xampp\\htdocs\\sana-portal\\core"`,
    "cd /e/xampp/htdocs/sana-portal",
    "see c:\\users\\dev\\.ssh",
  ]) assert.equal(ownPathHits(line, paths).length, 1, line);
  assert.equal(ownPathHits("E:/xampp/htdocs/sana-portal-old and /srv/xampp/htdocs/sana-portal", paths).length, 0);
  assert.equal(ownPathHits("use the project root", paths).length, 0);
});

test("a root or home that is too short to be a real folder is never matched", () => {
  assert.deepEqual(ownPaths("/", "/"), []);
});

test("other absolute paths are reported as foreign", () => {
  for (const line of ["D:\\Projects\\shop", "cd /home/ali/shop", "/c/Users/ali/shop", "C:/Users/ali"]) {
    assert.equal(foreignPathHits(line).length, 1, line);
  }
  for (const line of ["https://example.com/home/ali/page", "docs/page.md", "a:b", "use /api/users/list"]) {
    assert.equal(foreignPathHits(line).length, 0, line);
  }
});

test("pre-edit blocks text that names this project's folder, and allows the local file", () => {
  const here = path.join(dir, "docs");
  const payload = (file, content) => ({ cwd: dir, tool_name: "Write", tool_input: { file_path: path.join(dir, file), content } });
  let r = hook("pre-edit.mjs", payload("docs/setup.md", `Run git -c safe.directory=${dir.replace(/\\/g, "/")} status\n`));
  assert.equal(r.code, 2);
  assert.match(r.err, /docs\/setup\.md line 1/);
  assert.match(r.err, /\.doczi\.local\.json/);
  r = hook("pre-edit.mjs", payload(".doczi.local.json", JSON.stringify({ notes: [`root is ${dir}`] })));
  assert.equal(r.code, 0, r.err);
  r = hook("pre-edit.mjs", payload("docs/setup.md", "Run git status in the project root.\n"));
  assert.equal(r.code, 0, r.err);
  assert.ok(here);
});

test("localPaths.check false and localPaths.allow switch the block off", () => {
  write(".doczi.json", { rules: ["core"], localPaths: { check: false } });
  const payload = { cwd: dir, tool_name: "Write", tool_input: { file_path: path.join(dir, "a.md"), content: `at ${dir}\n` } };
  assert.equal(hook("pre-edit.mjs", payload).code, 0);
  write(".doczi.json", { rules: ["core"], localPaths: { allow: ["a.md"] } });
  assert.equal(hook("pre-edit.mjs", payload).code, 0);
});

test("session-start names this machine's project root and local notes", () => {
  write(".doczi.local.json", { notes: ["use the session proxy for git"] });
  const r = hook("session-start.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.err);
  const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Project root on this machine/);
  assert.match(ctx, /use the session proxy for git/);
  assert.match(ctx, /relative to the project root/);
});

test("check-paths fails on this machine's paths and only warns about other absolute paths", () => {
  write("ok.md", "see docs/page.md\n");
  write("warn.md", "colleague at D:\\Projects\\shop\n");
  spawnSync("git", ["add", "-A"], { cwd: dir });
  let r = run("check-paths");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /warn\.md:1: .*warning/);
  write("bad.md", `path ${dir.replace(/\\/g, "/")}/x\n`);
  spawnSync("git", ["add", "-A"], { cwd: dir });
  r = run("check-paths");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /bad\.md:1:/);
  assert.match(r.stderr, /\.doczi\.local\.json/);
});

// ---- init ----

test("init keeps .doczi.local.json out of git", () => {
  fs.rmSync(path.join(dir, ".doczi.json"));
  let r = run("init");
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^\.doczi\.local\.json$/m);
  r = run("init");
  assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8").match(/\.doczi\.local\.json/g).length, 1);
});

test("init stops when the upstream already has doczi files this checkout lacks", () => {
  const origin = path.join(tmp, "origin.git");
  spawnSync("git", ["init", "-q", "--bare", origin]);
  const other = path.join(tmp, "other");
  spawnSync("git", ["clone", "-q", origin, other]);
  fs.writeFileSync(path.join(other, ".doczi.json"), "{}");
  const git = (cwd, ...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd, encoding: "utf8" });
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "init");
  git(other, "push", "-q", "origin", "HEAD:main");
  fs.rmSync(path.join(dir, ".doczi.json"));
  git(dir, "remote", "add", "origin", origin);
  git(dir, "fetch", "-q", "origin");
  git(dir, "checkout", "-q", "-b", "work", "--track", "origin/main");
  fs.rmSync(path.join(dir, ".doczi.json"), { force: true });
  const r = run("init");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already has \.doczi\.json/);
  assert.match(r.stderr, /git pull/);
  assert.ok(!fs.existsSync(path.join(dir, "docs/progress/milestones.json")));
});

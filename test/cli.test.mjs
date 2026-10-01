import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TERMS } from "../lib/ai-terms.mjs";

const cli = fileURLToPath(new URL("../cli/doczi.mjs", import.meta.url));
const hookTemplate = fileURLToPath(new URL("../templates/git-hooks/doczi-commit-msg.cjs", import.meta.url));
let dir, env;

beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-cli-"));
  dir = path.join(tmp, "Shop App");
  fs.mkdirSync(dir);
  spawnSync("git", ["init", "-q", dir]);
  env = { ...process.env, DOCZI_HOME: path.join(tmp, "home") };
});

const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: "utf8" });

test("init writes .doczi.json and a starter progress file, registers the project, and never overwrites", () => {
  let r = run("init", "--check", "make check", "--rules", "core,clean-code");
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(dir, ".doczi.json"), "utf8"));
  assert.equal(config.name, "Shop App");
  assert.equal(config.check, "make check");
  assert.deepEqual(config.rules, ["core", "clean-code"]);
  assert.ok(fs.existsSync(path.join(dir, "docs/progress/milestones.json")));
  assert.match(r.stdout, /Registered as "shop-app"/);

  fs.writeFileSync(path.join(dir, ".doczi.json"), JSON.stringify({ name: "Mine" }));
  r = run("init", "--check", "other");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /kept/i);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".doczi.json"), "utf8")).name, "Mine");
});

test("init --page copies the dashboard next to the progress file", () => {
  run("init", "--page");
  for (const f of ["index.html", "app.js", "theme.js", "style.css"]) assert.ok(fs.existsSync(path.join(dir, "docs/progress", f)), f);
});

test("progress shows a summary, and set/add change the file", () => {
  run("init");
  let r = run("progress");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0% overall/);
  r = run("progress", "set", "M0", "1", "1", "done");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /todo → done/);
  r = run("progress", "add", "M0", "1", "Write the README", "--status", "doing");
  assert.equal(r.status, 0, r.stderr);
  r = run("progress", "--milestone", "M0");
  assert.match(r.stdout, /\[x\] 1\./);
  assert.match(r.stdout, /\[~\] \d+\. Write the README/);
  r = run("progress", "set", "M0", "1", "1", "finished");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /done, review, doing, blocked or todo/);
});

test("projects lists, adds and removes registrations", () => {
  run("init");
  assert.match(run("projects").stdout, /shop-app/);
  assert.equal(run("projects", "remove", "shop-app").status, 0);
  assert.doesNotMatch(run("projects").stdout, /shop-app/);
  assert.equal(run("projects", "add", ".").status, 0);
  assert.match(run("projects").stdout, /shop-app/);
});

test("check-ai reports mentions in the given files and skips allowed ones", () => {
  fs.writeFileSync(path.join(dir, "a.js"), "// built with codex\n");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "Claude rules\n");
  const r = run("check-ai", "a.js", "CLAUDE.md");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /a\.js:1/);
  assert.doesNotMatch(r.stdout, /CLAUDE\.md/);
  fs.writeFileSync(path.join(dir, "a.js"), "// fine\n");
  assert.equal(run("check-ai", "a.js").status, 0);
});

test("git-hooks installs a commit-msg hook that strips attribution and refuses the rest", () => {
  const r = run("git-hooks");
  assert.equal(r.status, 0, r.stderr);
  const hook = path.join(dir, ".git", "hooks", "commit-msg");
  assert.ok(fs.existsSync(hook));
  const msg = path.join(dir, "MSG");
  fs.writeFileSync(msg, "feat: add cart\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n");
  // Run it the way git does: through sh.
  let h = spawnSync("sh", [hook, msg], { cwd: dir, encoding: "utf8" });
  assert.equal(h.status, 0, h.stderr);
  assert.equal(fs.readFileSync(msg, "utf8"), "feat: add cart\n");
  fs.writeFileSync(msg, "feat: cart logic from chatgpt\n");
  h = spawnSync("sh", [hook, msg], { cwd: dir, encoding: "utf8" });
  assert.equal(h.status, 1);
  // A foreign hook is never replaced.
  fs.writeFileSync(hook, "#!/bin/sh\necho mine\n");
  assert.match(run("git-hooks").stdout, /already has a commit-msg hook/);
  assert.match(fs.readFileSync(hook, "utf8"), /echo mine/);
});

test("the standalone commit-msg hook uses the same terms as doczi", () => {
  const text = fs.readFileSync(hookTemplate, "utf8");
  const embedded = JSON.parse(text.match(/const TERMS = (\[[\s\S]*?\]);/)[1]);
  assert.deepEqual(embedded, DEFAULT_TERMS);
});

test("help lists the commands", () => {
  const r = run("help");
  assert.equal(r.status, 0);
  for (const c of ["init", "progress", "check-ai", "git-hooks", "projects", "serve", "mcp"]) assert.match(r.stdout, new RegExp(c));
});

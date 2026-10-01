import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LockBusyError, withLockSync } from "../lib/lock.mjs";

const cli = fileURLToPath(new URL("../cli/doczi.mjs", import.meta.url));
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-lock-")); });

test("withLockSync runs the change and removes its lock file", () => {
  const file = path.join(tmp, "a.json");
  assert.equal(withLockSync(file, () => 42), 42);
  assert.equal(fs.existsSync(file + ".lock"), false);
  assert.throws(() => withLockSync(file, () => { throw new Error("boom"); }), /boom/);
  assert.equal(fs.existsSync(file + ".lock"), false, "released after a failing change too");
});

test("a held lock makes others wait, then give up with LockBusyError", () => {
  const file = path.join(tmp, "b.json");
  fs.writeFileSync(file + ".lock", "someone else");
  const started = Date.now();
  assert.throws(() => withLockSync(file, () => 1, { timeoutMs: 200 }), LockBusyError);
  assert.ok(Date.now() - started >= 180, "waited before giving up");
  assert.equal(fs.readFileSync(file + ".lock", "utf8"), "someone else", "another writer's lock is left alone");
});

test("a stale lock is broken", () => {
  const file = path.join(tmp, "c.json");
  fs.writeFileSync(file + ".lock", "crashed writer");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(file + ".lock", old, old);
  assert.equal(withLockSync(file, () => "ran", { timeoutMs: 200 }), "ran");
  assert.equal(fs.existsSync(file + ".lock"), false);
});

test("parallel writers lose nothing", async () => {
  const dir = path.join(tmp, "race");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "progress"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs/progress/milestones.json"),
    JSON.stringify({ milestones: [{ id: "M0", name: "Race", tasks: [{ name: "T", steps: [] }] }] }));
  const env = { ...process.env, DOCZI_HOME: path.join(tmp, "home") };
  const runs = Array.from({ length: 12 }, (_, i) => new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, "progress", "add", "M0", "T", `Step ${i}`], { cwd: dir, env });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, err }));
  }));
  const results = await Promise.all(runs);
  for (const r of results) assert.equal(r.code, 0, r.err);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "docs/progress/milestones.json"), "utf8"));
  assert.equal(saved.milestones[0].tasks[0].steps.length, 12);
  assert.equal(fs.existsSync(path.join(dir, "docs/progress/milestones.json.lock")), false);
});

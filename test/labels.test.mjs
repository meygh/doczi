// Task types and tags: optional labels that sort and filter tasks without changing progress.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, labelTask, parse, summarize, TASK_TYPES, validate } from "../lib/progress.mjs";
import { listText } from "../lib/report.mjs";

const sample = () => ({
  milestones: [{
    id: "M0", name: "Start",
    tasks: [
      { name: "Login", type: "feature", tags: ["auth", "ui"], steps: [{ status: "done", title: "Form" }] },
      { name: "Crash on save", type: "bug", tags: ["ui"], steps: [{ status: "todo", title: "Fix" }] },
      { name: "Plain", steps: [{ status: "todo", title: "a" }] },
    ],
  }],
});

test("the task types cover features, bugs, issues, refinements, redesigns and housekeeping", () => {
  assert.deepEqual(TASK_TYPES, ["feature", "bug", "issue", "refinement", "redesign", "chore", "docs", "research", "security"]);
});

test("a type and tags are optional and valid when well formed, including tags in other scripts", () => {
  const d = sample();
  d.milestones[0].tasks[2].tags = ["پرداخت", "v2"];
  assert.deepEqual(validate(d), []);
});

test("validation refuses an unknown type, too many, duplicate or malformed tags", () => {
  const bad = (task) => validate({ milestones: [{ id: "M0", name: "S", tasks: [{ name: "T", steps: [], ...task }] }] });
  assert.match(bad({ type: "epic" }).join(), /type "epic".*feature, bug/);
  assert.match(bad({ tags: "ui" }).join(), /"tags" must be a list/);
  assert.match(bad({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }).join(), /at most 10 tags/);
  assert.match(bad({ tags: ["ui", "ui"] }).join(), /tag "ui" twice/);
  for (const tag of ["UI", "two words", "", "-x", "a".repeat(31), 5]) assert.match(bad({ tags: [tag] }).join(), /tag/, String(tag));
});

test("summarize carries each task's type and tags and counts tasks per type", () => {
  const s = summarize(sample());
  assert.equal(s.milestones[0].tasks[0].type, "feature");
  assert.deepEqual(s.milestones[0].tasks[1].tags, ["ui"]);
  assert.deepEqual(s.milestones[0].tasks[2].tags, []);
  assert.deepEqual(s.counts.types, { feature: 1, bug: 1 });
});

test("labelTask sets or clears the type, and replaces, adds or removes tags, normalising them", () => {
  const d = sample();
  let r = labelTask(d, { milestone: "M0", task: "plain", type: "refinement", add: [" Front End ", "ui"] }, "2026-10-01");
  assert.equal(r.task.type, "refinement");
  assert.deepEqual(r.task.tags, ["front-end", "ui"]);
  assert.equal(d.updated, "2026-10-01");
  r = labelTask(d, { milestone: "M0", task: "plain", remove: ["ui"], add: ["front-end"] });
  assert.deepEqual(r.task.tags, ["front-end"]);
  r = labelTask(d, { milestone: "M0", task: "plain", type: "none", tags: [] });
  assert.equal("type" in r.task, false);
  assert.equal("tags" in r.task, false);
  assert.throws(() => labelTask(d, { milestone: "M0", task: "plain", type: "epic" }), /feature, bug/);
  assert.throws(() => labelTask(d, { milestone: "M0", task: "plain", add: ["bad tag!"] }), /tag/);
});

test("format keeps tags readable and parses back to the same data", () => {
  const d = sample();
  assert.deepEqual(parse(format(d)), d);
  assert.match(format(d), /"type": "feature",\n\s+"tags": \[\n\s+"auth",\n\s+"ui"\n\s+\]/);
});

test("the step list shows a task's type and tags", () => {
  assert.match(listText(sample()), /1\. Login \[feature\] #auth #ui — 100%/);
  assert.match(listText(sample()), /3\. Plain — 0%/);
});

test("the CLI labels a task", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-labels-"));
  fs.mkdirSync(path.join(dir, "docs/progress"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".doczi.json"), "{}");
  fs.writeFileSync(path.join(dir, "docs/progress/milestones.json"), format(sample()));
  const cli = fileURLToPath(new URL("../cli/doczi.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, DOCZI_HOME: path.join(dir, ".home") }, encoding: "utf8" });
  let r = run("progress", "label", "M0", "plain", "--type", "bug", "--add", "api,ui");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Plain: \[bug\] #api #ui/);
  r = run("progress", "label", "M0", "plain", "--remove", "ui");
  assert.match(r.stdout, /Plain: \[bug\] #api/);
  r = run("progress", "label", "M0", "plain", "--type", "epic");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /feature, bug/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "docs/progress/milestones.json"), "utf8"));
  assert.deepEqual(saved.milestones[0].tasks[2].tags, ["api"]);
});

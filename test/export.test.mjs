// Exports of the progress file: Markdown and CSV for people and spreadsheets, JSON as stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "../lib/progress.mjs";
import { toCsv, toJson, toMarkdown } from "../lib/export.mjs";

const sample = () => ({
  title: "Shop", subtitle: "Where we are", updated: "2026-10-01",
  milestones: [{
    id: "M0", name: "Start", when: "weeks 1–2", exit: "It runs.",
    tasks: [
      {
        name: "Checkout *fast*", type: "feature", tags: ["ui", "پرداخت"],
        questions: [{ q: "Which gateway?", a: "Crypto" }, { q: "Refunds?" }],
        steps: [
          { status: "done", title: "Cart" },
          { status: "review", title: "Pay, then \"confirm\"" },
          { status: "blocked", title: "=SUM(A1)", reason: "Waiting for keys" },
        ],
      },
      { name: "Empty", steps: [] },
    ],
  }],
});

test("Markdown lists milestones, tasks and steps with their progress, labels and questions", () => {
  const md = toMarkdown(sample());
  assert.match(md, /^# Shop\n\nWhere we are\n\nUpdated 2026-10-01 · 29% overall · 1 of 3 steps done\n/);
  assert.match(md, /\n## M0 Start: 29% \(Blocked\)\n/);
  assert.match(md, /When: weeks 1–2 · Done when: It runs\./);
  assert.match(md, /\n### Checkout \\\*fast\\\*: 58% \(Blocked\)\n\nType: Feature · Tags: ui, پرداخت\n/);
  assert.match(md, /\n- \[x\] Cart\n- \[ \] Pay, then "confirm" \(Waiting for your check\)\n- \[ \] =SUM\(A1\) \(Blocked: Waiting for keys\)\n/);
  assert.match(md, /- Q: Which gateway\?\n  A: Crypto\n- Q: Refunds\?\n  A: \(no answer yet\)/);
  assert.match(md, /\n### Empty: 0% \(Not started\)\n\nNo steps yet\.\n/);
});

test("CSV has one row per step, quotes what needs it and defuses spreadsheet formulas", () => {
  const csv = toCsv(sample());
  assert.ok(csv.startsWith("﻿"), "a byte order mark, so spreadsheets read UTF-8");
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], "Milestone ID,Milestone,Task,Type,Tags,Task status,Task progress,Step,Step status,Reason");
  assert.equal(lines[1], "M0,Start,Checkout *fast*,Feature,ui پرداخت,Blocked,58,Cart,Done,");
  assert.equal(lines[2], 'M0,Start,Checkout *fast*,Feature,ui پرداخت,Blocked,58,"Pay, then ""confirm""",Waiting for your check,');
  assert.equal(lines[3], "M0,Start,Checkout *fast*,Feature,ui پرداخت,Blocked,58,'=SUM(A1),Blocked,Waiting for keys");
  assert.equal(lines[4], "M0,Start,Empty,,,Not started,0,,,");
  assert.equal(lines[5], "");
  assert.equal(lines.length, 6);
});

test("JSON export is the file as doczi writes it", () => {
  assert.equal(toJson(sample()), format(sample()));
});

test("the CLI exports to a new file, to standard output, and never overwrites", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-export-"));
  fs.mkdirSync(path.join(dir, "docs/progress"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".doczi.json"), "{}");
  fs.writeFileSync(path.join(dir, "docs/progress/milestones.json"), format(sample()));
  const cli = fileURLToPath(new URL("../cli/doczi.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, DOCZI_HOME: path.join(dir, ".home") }, encoding: "utf8" });

  let r = run("export", "--format", "csv", "--out", "plan.csv");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Wrote plan\.csv/);
  assert.match(fs.readFileSync(path.join(dir, "plan.csv"), "utf8"), /^﻿Milestone ID,/);

  fs.writeFileSync(path.join(dir, "taken.md"), "mine");
  r = run("export", "--out", "taken.md");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /taken\.md already exists/);
  assert.equal(fs.readFileSync(path.join(dir, "taken.md"), "utf8"), "mine");

  r = run("export", "--out", "-");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^# Shop\n/);

  r = run("export");
  assert.equal(r.status, 0, r.stderr);
  const made = fs.readdirSync(dir).find((f) => /^shop-progress-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  assert.ok(made, "a default name from the title and today's date");

  r = run("export", "--format", "pdf");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /md, csv or json/);
});

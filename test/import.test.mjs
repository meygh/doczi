// Importing tasks from documents: a Markdown checklist becomes tasks and steps linked to their
// sections; a plan merges into the progress file without duplicates or lost statuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { headingAnchors, mergePlan, planFromMarkdown } from "../lib/importer.mjs";
import { format } from "../lib/progress.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

const DOC = `# Shop requirements

Intro text.

## Checkout

- [x] Cart page
- [ ] Payment page
  - [ ] Card form
- not a step

\`\`\`md
- [ ] inside a code block
\`\`\`

## Checkout

- [ ] Receipts

### PAY: Payments & refunds

* [ ] Refund flow
- [X] Webhooks

## Empty section
`;

test("a Markdown checklist becomes tasks per heading, with steps and links to their sections", () => {
  const plan = planFromMarkdown(DOC, { file: "docs/SRS.md", milestone: "M1", name: "Shop" });
  assert.deepEqual(plan, {
    milestones: [{
      id: "M1", name: "Shop",
      tasks: [
        { name: "Checkout", docs: [{ title: "Checkout", path: "docs/SRS.md#checkout" }], steps: [
          { status: "done", title: "Cart page" }, { status: "todo", title: "Payment page" }, { status: "todo", title: "Card form" },
        ] },
        { name: "Checkout (2)", docs: [{ title: "Checkout", path: "docs/SRS.md#checkout-1" }], steps: [{ status: "todo", title: "Receipts" }] },
        { name: "PAY: Payments & refunds", docs: [{ title: "PAY: Payments & refunds", path: "docs/SRS.md#pay-payments-refunds" }], steps: [
          { status: "todo", title: "Refund flow" }, { status: "done", title: "Webhooks" },
        ] },
      ],
    }],
  });
});

test("with bullets on, plain list items become steps too", () => {
  const plan = planFromMarkdown(DOC, { file: "docs/SRS.md", milestone: "M1", bullets: true });
  assert.deepEqual(plan.milestones[0].tasks[0].steps.map((s) => s.title), ["Cart page", "Payment page", "Card form", "not a step"]);
  assert.equal(plan.milestones[0].name, "M1");
});

test("with bullets on, numbered list items become steps as well", () => {
  const plan = planFromMarkdown("## Steps\n\n1. First\n2) Second\n10. Tenth\n", { file: "p.md", milestone: "M1", bullets: true });
  assert.deepEqual(plan.milestones[0].tasks[0].steps.map((s) => s.title), ["First", "Second", "Tenth"]);
});

test("section links use the same anchors as the dashboard's document reader", () => {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(repo, "web/markdown.js"), "utf8"), ctx);
  const { html } = ctx.docziMarkdown.render(DOC, { linked: new Set(), dir: "" });
  const rendered = [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(headingAnchors(DOC).map((h) => h.anchor), rendered);
});

const base = () => ({
  title: "Shop",
  milestones: [{ id: "M1", name: "Shop", tasks: [{ name: "checkout", steps: [{ status: "doing", title: "Cart page" }] }] }],
});

test("merging adds only what is new and never changes an existing step's status", () => {
  const data = base();
  const plan = planFromMarkdown(DOC, { file: "docs/SRS.md", milestone: "m1" });
  const first = mergePlan(data, plan, "2026-10-01");
  assert.deepEqual(first.added, { milestones: 0, tasks: 2, steps: 5 });
  assert.equal(first.kept, 1);
  const checkout = data.milestones[0].tasks[0];
  assert.equal(checkout.steps[0].status, "doing", "the existing step keeps its status");
  assert.deepEqual(checkout.docs, [{ title: "Checkout", path: "docs/SRS.md#checkout" }], "a missing link is added");
  assert.equal(data.updated, "2026-10-01");
  const again = mergePlan(data, plan, "2026-10-02");
  assert.deepEqual(again.added, { milestones: 0, tasks: 0, steps: 0 });
  assert.equal(data.updated, "2026-10-01", "nothing new, nothing touched");
});

test("merging creates new milestones and refuses an invalid plan as a whole", () => {
  const data = base();
  const r = mergePlan(data, { milestones: [{ id: "M2", name: "Payments", when: "weeks 3–4", tasks: [{ name: "Gateway", type: "feature", tags: ["pay"], steps: [{ title: "Interface" }] }] }] });
  assert.deepEqual(r.added, { milestones: 1, tasks: 1, steps: 1 });
  assert.equal(data.milestones[1].tasks[0].steps[0].status, "todo");
  const before = JSON.stringify(data);
  assert.throws(() => mergePlan(data, { milestones: [{ id: "M3", name: "X", tasks: [{ name: "T", type: "epic", steps: [] }] }] }), /type "epic"/);
  assert.throws(() => mergePlan(data, { milestones: [{ id: "M3", name: "X", tasks: [{ name: "T", steps: [{ title: "a", status: "finished" }] }] }] }), /finished/);
  assert.throws(() => mergePlan(data, { milestones: [{ id: "M3", name: "X", tasks: [{ name: "T", docs: ["../outside.md"], steps: [] }] }] }), /inside the project/);
  assert.throws(() => mergePlan(data, { milestones: "nope" }), /milestones/);
  assert.equal(JSON.stringify(data), before, "a refused plan changes nothing");
});

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-import-"));
  fs.mkdirSync(path.join(dir, "docs/progress"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".doczi.json"), "{}");
  fs.writeFileSync(path.join(dir, "docs/progress/milestones.json"), format(base()));
  fs.writeFileSync(path.join(dir, "docs/SRS.md"), DOC);
  const cli = path.join(repo, "cli/doczi.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, DOCZI_HOME: path.join(dir, ".home") }, encoding: "utf8" });
  return { dir, run, read: () => JSON.parse(fs.readFileSync(path.join(dir, "docs/progress/milestones.json"), "utf8")) };
}

test("the CLI previews an import, writes it only with --write, and adds nothing the second time", () => {
  const { run, read } = project();
  let r = run("import", "docs/SRS.md", "--milestone", "M1");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Would add 2 tasks and 5 steps/);
  assert.match(r.stdout, /\+ Checkout \(2\)/);
  assert.match(r.stdout, /--write/);
  assert.equal(read().milestones[0].tasks.length, 1, "a preview writes nothing");
  r = run("import", "docs/SRS.md", "--milestone", "M1", "--write");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Added 2 tasks and 5 steps/);
  assert.equal(read().milestones[0].tasks.length, 3);
  r = run("import", "docs/SRS.md", "--milestone", "M1", "--write");
  assert.match(r.stdout, /Nothing new to add/);
});

test("the CLI imports a JSON plan, and refuses documents outside the project", () => {
  const { dir, run, read } = project();
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ milestones: [{ id: "M2", name: "Pay", tasks: [{ name: "Gateway", steps: [{ title: "Interface" }] }] }] }));
  let r = run("import", "plan.json", "--write");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read().milestones[1].id, "M2");
  const outside = path.join(os.tmpdir(), `doczi-outside-${process.pid}.md`);
  fs.writeFileSync(outside, "## T\n- [ ] a\n");
  r = run("import", outside, "--milestone", "M1");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /inside the project/);
  r = run("import", "docs/SRS.md");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--milestone/);
});

// ---- Hardening (security review of the import) ----

test("a heading with a long run of spaces parses in linear time, here and in the reader", () => {
  const evil = "# a" + " ".repeat(200_000) + "x";
  let t = Date.now();
  headingAnchors(evil);
  assert.ok(Date.now() - t < 500, `importer took ${Date.now() - t} ms`);
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(repo, "web/markdown.js"), "utf8"), ctx);
  t = Date.now();
  ctx.docziMarkdown.render(evil, {});
  assert.ok(Date.now() - t < 500, `reader took ${Date.now() - t} ms`);
});

test("a closing run of # is dropped only after a space, so C# keeps its name", () => {
  assert.deepEqual(headingAnchors("## Title ##\n## C#\n### #\n").map((h) => [h.title, h.anchor]), [["Title", "title"], ["C#", "c"], ["", "section"]]);
});

test("imported text loses control and direction characters and is cut to 300 characters", () => {
  const plan = planFromMarkdown(`## T\x1b[31m\n- [ ] a‮b\u0007c​\n- [ ] ${"x".repeat(400)}\n`, { file: "d.md", milestone: "M1" });
  const task = plan.milestones[0].tasks[0];
  assert.equal(task.name, "T[31m");
  assert.equal(task.steps[0].title, "abc");
  assert.equal(task.steps[1].title.length, 300);
  assert.ok(task.steps[1].title.endsWith("…"));
});

test("a plan is refused when it is too large, has odd ids or text fields of the wrong kind", () => {
  const one = (task, m = {}) => ({ milestones: [{ id: "M5", name: "X", ...m, tasks: [{ name: "T", steps: [], ...task }] }] });
  assert.throws(() => mergePlan(base(), one({ steps: Array.from({ length: 501 }, (_, i) => ({ title: `s${i}` })) })), /at most 500 steps/);
  assert.throws(() => mergePlan(base(), one({ name: "n".repeat(301) })), /300 characters/);
  assert.throws(() => mergePlan(base(), one({}, { id: "M5\nignore this" })), /id/);
  assert.throws(() => mergePlan(base(), one({}, { when: 12 })), /"when" must be text/);
  assert.throws(() => mergePlan(base(), one({}, { exit: { a: 1 } })), /"exit" must be text/);
});

test("only known fields of a plan are stored, as copies", () => {
  const data = base();
  const docs = [{ path: "a.md", title: { x: 1 }, evil: "y" }];
  const plan = { milestones: [{ id: "M5", name: "X", tasks: [{ name: "T", docs, odd: true, steps: [{ title: "s", extra: 1 }] }] }] };
  mergePlan(data, plan);
  const task = data.milestones[1].tasks[0];
  assert.deepEqual(task, { name: "T", docs: [{ path: "a.md" }], steps: [{ status: "todo", title: "s" }] });
  docs[0].path = "changed.md";
  assert.equal(task.docs[0].path, "a.md");
});

test("merging 5,000 steps stays fast", () => {
  const plan = { milestones: Array.from({ length: 10 }, (_, m) => ({ id: `M${m + 10}`, name: "X", tasks: [{ name: "T", steps: Array.from({ length: 500 }, (_, i) => ({ title: `s${i}` })) }] })) };
  const t = Date.now();
  mergePlan(base(), plan);
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
});

test("a broken JSON plan is refused without echoing the file", () => {
  const { dir, run } = project();
  fs.writeFileSync(path.join(dir, "secrets.json"), '{"token": "s3cr3t-value" oops');
  const r = run("import", "secrets.json");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a valid JSON plan/);
  assert.doesNotMatch(r.stderr, /s3cr3t/);
});

const canSymlink = (() => {
  try { const d = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-ln-")); fs.symlinkSync(path.join(d, "x"), path.join(d, "l")); return true; } catch { return false; }
})();

test("a linked source file is refused", { skip: canSymlink ? false : "symlinks need extra rights here" }, () => {
  const { dir, run } = project();
  fs.symlinkSync(path.join(dir, "docs/SRS.md"), path.join(dir, "docs/link.md"));
  const r = run("import", "docs/link.md", "--milestone", "M1");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /link/);
});

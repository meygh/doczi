import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, validate, setStatus, addStep, addQuestion, answerQuestion, format, parse, findStep, STATUSES } from "../lib/progress.mjs";

const sample = () => ({
  title: "Sample",
  updated: "2026-01-01",
  milestones: [
    {
      id: "M0", name: "Foundations", weight: 1,
      tasks: [
        { name: "Repo", steps: [{ status: "done", title: "Layout" }, { status: "doing", title: "CI" }] },
        { name: "Docs", steps: [{ status: "todo", title: "README" }] },
      ],
    },
    { id: "M1", name: "Core", weight: 3, tasks: [{ name: "Engine", steps: [{ status: "todo", title: "Interpreter" }] }] },
  ],
});

test("statuses are ordered from finished to not started", () => {
  assert.deepEqual(STATUSES, ["done", "review", "doing", "blocked", "todo"]);
});

test("summarize counts done 1, review ¾, doing ½, blocked and todo 0; averages tasks; weights milestones", () => {
  const s = summarize(sample());
  assert.equal(s.milestones[0].tasks[0].percent, 75);
  assert.equal(s.milestones[0].tasks[1].percent, 0);
  assert.equal(s.milestones[0].percent, 38);
  assert.equal(s.percent, 9);
  assert.deepEqual(s.counts.steps, { total: 4, done: 1, review: 0, doing: 1, blocked: 0, todo: 2 });
  assert.deepEqual(s.counts.tasks, { total: 3, done: 0, review: 0, doing: 1, blocked: 0, todo: 2 });
  assert.deepEqual(s.counts.milestones, { total: 2, done: 0, review: 0, doing: 1, blocked: 0, todo: 1 });
  assert.equal(s.current.id, "M0");

  const d = sample();
  d.milestones[0].tasks[0].steps = [{ status: "review", title: "a" }, { status: "blocked", title: "b", reason: "No keys" }];
  const t = summarize(d).milestones[0].tasks[0];
  assert.equal(t.percent, 38); // (0.75 + 0) / 2
  assert.deepEqual(t.share, { done: 0, review: 0.375, doing: 0 });
});

test("task and milestone status is derived: blocked wins, then done, review, doing, todo", () => {
  const d = sample();
  const task = (steps, extra = {}) => { d.milestones[0].tasks[0] = { name: "Repo", steps, ...extra }; return summarize(d).milestones[0].tasks[0]; };
  assert.equal(task([{ status: "done", title: "a" }]).status, "done");
  assert.equal(task([{ status: "done", title: "a" }, { status: "review", title: "b" }]).status, "review");
  assert.equal(task([{ status: "done", title: "a" }, { status: "todo", title: "b" }]).status, "doing");
  assert.equal(task([{ status: "todo", title: "a" }]).status, "todo");
  const blocked = task([{ status: "done", title: "a" }, { status: "blocked", title: "b", reason: "Waiting for API keys" }]);
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.reasons, ["b: Waiting for API keys"]);
  assert.deepEqual(task([{ status: "doing", title: "a" }], { blocked: "Vendor contract" }).reasons, ["Vendor contract"]);
  d.milestones[0].blocked = "Budget review";
  assert.equal(summarize(d).milestones[0].status, "blocked");
  assert.deepEqual(summarize(d).milestones[0].reasons, ["Budget review", "Repo: Vendor contract"]);
});

test("summarize treats a missing weight as 1 and an empty task as not started", () => {
  const d = { milestones: [{ id: "A", name: "A", tasks: [{ name: "T", steps: [] }] }] };
  const s = summarize(d);
  assert.equal(s.percent, 0);
  assert.equal(s.milestones[0].weight, 1);
  assert.equal(s.milestones[0].tasks[0].status, "todo");
});

test("validate accepts the sample and reports every problem otherwise", () => {
  assert.deepEqual(validate(sample()), []);
  const bad = sample();
  bad.milestones[1].id = "M0";
  bad.milestones[0].tasks[0].steps[0].status = "finished";
  bad.milestones[0].weight = -1;
  bad.milestones[0].tasks[1].questions = [{ q: "" }];
  bad.docs = [{ title: "SRS", path: "../secret.md" }];
  const problems = validate(bad);
  assert.equal(problems.length, 5, problems.join("\n"));
  assert.match(problems.join("\n"), /duplicate milestone id "M0"/);
  assert.match(problems.join("\n"), /"finished"/);
  assert.match(problems.join("\n"), /weight/);
  assert.match(problems.join("\n"), /question/);
  assert.match(problems.join("\n"), /inside the project/);
  assert.deepEqual(validate(null), ['The file needs a "milestones" list.']);
});

test("validate accepts docs, questions and reasons", () => {
  const d = sample();
  d.docs = [{ title: "Requirements", path: "docs/SRS.md#milestones" }, { path: "docs/ARCHITECTURE.md" }];
  d.milestones[0].docs = [{ title: "Plan", path: "docs/plans/m0.md" }];
  d.milestones[0].tasks[0].questions = [{ q: "Which CI?", a: "GitHub Actions" }, { q: "Sign images?" }];
  d.milestones[0].tasks[0].steps[1] = { status: "blocked", title: "CI", reason: "No runner" };
  assert.deepEqual(validate(d), []);
});

test("setStatus finds a step by title (case-insensitive) or by 1-based number", () => {
  const d = sample();
  const r = setStatus(d, { milestone: "m0", task: "repo", step: "ci", status: "done" }, "2026-02-02");
  assert.equal(r.previous, "doing");
  assert.equal(d.milestones[0].tasks[0].steps[1].status, "done");
  assert.equal(d.updated, "2026-02-02");
  setStatus(d, { milestone: "M0", task: 2, step: 1, status: "review" });
  assert.equal(d.milestones[0].tasks[1].steps[0].status, "review");
});

test("setStatus needs a reason for blocked and drops it when unblocked", () => {
  const d = sample();
  assert.throws(() => setStatus(d, { milestone: "M0", task: 1, step: 2, status: "blocked" }), /reason/);
  setStatus(d, { milestone: "M0", task: 1, step: 2, status: "blocked", reason: "  Runner quota  " });
  assert.deepEqual(d.milestones[0].tasks[0].steps[1], { status: "blocked", title: "CI", reason: "Runner quota" });
  setStatus(d, { milestone: "M0", task: 1, step: 2, status: "doing" });
  assert.deepEqual(d.milestones[0].tasks[0].steps[1], { status: "doing", title: "CI" });
});

test("setStatus rejects unknown steps, bad statuses and ambiguous titles", () => {
  const d = sample();
  assert.throws(() => setStatus(d, { milestone: "M9", task: "Repo", step: "CI", status: "done" }), /No milestone "M9"/);
  assert.throws(() => setStatus(d, { milestone: "M0", task: "Repo", step: "Nope", status: "done" }), /No step "Nope"/);
  assert.throws(() => setStatus(d, { milestone: "M0", task: "Repo", step: "CI", status: "finished" }), /done, review, doing, blocked or todo/);
  d.milestones[0].tasks[0].steps.push({ status: "todo", title: "ci" });
  assert.throws(() => setStatus(d, { milestone: "M0", task: "Repo", step: "CI", status: "done" }), /more than one/);
});

test("findStep matches a partial title only when it is unique", () => {
  const d = sample();
  assert.equal(findStep(d, { milestone: "M1", task: "Engine", step: "interp" }).step.title, "Interpreter");
});

test("addStep appends to an existing task, or creates the task", () => {
  const d = sample();
  addStep(d, { milestone: "M1", task: "Engine", title: "Drivers" });
  assert.deepEqual(d.milestones[1].tasks[0].steps.at(-1), { status: "todo", title: "Drivers" });
  addStep(d, { milestone: "M1", task: "Compiler", title: "Type checks", status: "doing" });
  assert.deepEqual(d.milestones[1].tasks[1], { name: "Compiler", steps: [{ status: "doing", title: "Type checks" }] });
  assert.throws(() => addStep(d, { milestone: "M1", task: "Engine", title: "Drivers" }), /already exists/);
});

test("questions can be asked and answered", () => {
  const d = sample();
  addQuestion(d, { milestone: "M0", task: "Repo", question: "Which CI?" });
  assert.throws(() => addQuestion(d, { milestone: "M0", task: "Repo", question: "which ci?" }), /already asked/);
  const r = answerQuestion(d, { milestone: "M0", task: "Repo", question: 1, answer: "GitHub Actions" });
  assert.equal(r.question, "Which CI?");
  assert.deepEqual(d.milestones[0].tasks[0].questions, [{ q: "Which CI?", a: "GitHub Actions" }]);
  assert.throws(() => answerQuestion(d, { milestone: "M0", task: "Repo", question: 2, answer: "x" }), /No question number 2/);
});

test("format writes one step per line and parses back to the same data", () => {
  const d = sample();
  d.milestones[0].tasks[0].steps[1] = { status: "blocked", title: "CI", reason: "No \"runner\"" };
  const text = format(d);
  assert.match(text, /\n {12}\{ "status": "done", "title": "Layout" \},\n/);
  assert.match(text, /\{ "status": "blocked", "title": "CI", "reason": "No \\"runner\\"" \}/);
  assert.ok(text.endsWith("}\n"));
  assert.deepEqual(parse(text), d);
});

test("format keeps a step with other extra fields readable", () => {
  const d = sample();
  d.milestones[0].tasks[0].steps[0].owner = "sam";
  assert.deepEqual(parse(format(d)), d);
});

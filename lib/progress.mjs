// Progress model: milestones → tasks → steps. Percentages are never stored; they are
// worked out here from step statuses so every view (page, CLI, API, MCP) agrees.

// From finished to not started. Labels are what people see.
export const STATUSES = ["done", "review", "doing", "blocked", "todo"];
export const LABELS = { done: "Done", review: "Waiting for your check", doing: "In progress", blocked: "Blocked", todo: "Not started" };
// How much a step counts towards progress. Work waiting for a check is nearly done; blocked
// work counts nothing until it moves again.
export const WORTH = { done: 1, review: 0.75, doing: 0.5, blocked: 0, todo: 0 };
const STATUS_LIST = "done, review, doing, blocked or todo";

// ---- Validation ----

function checkDocs(docs, where, problems) {
  if (docs === undefined) return;
  if (!Array.isArray(docs)) { problems.push(`${where}: "docs" must be a list.`); return; }
  docs.forEach((d, i) => {
    const p = typeof d === "string" ? d : d?.path;
    if (typeof p !== "string" || !p.trim()) problems.push(`${where}: document ${i + 1} needs a "path".`);
    else if (/^([a-z]+:|\/|\\)/i.test(p) || p.split("#")[0].includes(":") || p.split(/[\\/#]/).includes("..")) problems.push(`${where}: document "${p}" must be a path inside the project (no "..", ":", absolute path or URL).`);
  });
}

export function validate(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.milestones)) return ['The file needs a "milestones" list.'];
  const problems = [];
  const seen = new Set();
  checkDocs(data.docs, "Project", problems);
  data.milestones.forEach((m, i) => {
    const where = `Milestone ${i + 1}${m?.id ? ` (${m.id})` : ""}`;
    if (!m || typeof m.id !== "string" || !m.id || typeof m.name !== "string" || !m.name) {
      problems.push(`${where} needs an "id" and a "name".`);
      return;
    }
    if (seen.has(m.id.toLowerCase())) problems.push(`There is a duplicate milestone id "${m.id}".`);
    seen.add(m.id.toLowerCase());
    if (m.weight !== undefined && !(typeof m.weight === "number" && m.weight >= 0)) problems.push(`${where}: "weight" must be a number of 0 or more.`);
    checkDocs(m.docs, where, problems);
    if (!Array.isArray(m.tasks)) { problems.push(`${where} needs a "tasks" list.`); return; }
    m.tasks.forEach((t, j) => {
      if (!t || typeof t.name !== "string" || !t.name || !Array.isArray(t.steps)) {
        problems.push(`${where}, task ${j + 1} needs a "name" and a "steps" list.`);
        return;
      }
      checkDocs(t.docs, `${where}, "${t.name}"`, problems);
      if (t.questions !== undefined && (!Array.isArray(t.questions) || t.questions.some((q) => !q || typeof q.q !== "string" || !q.q.trim() || (q.a !== undefined && typeof q.a !== "string") || (q.by !== undefined && q.by !== "agent" && q.by !== "user")))) {
        problems.push(`${where}, "${t.name}": each question needs a "q" text (and an optional "a" answer, "by" agent or user).`);
      }
      t.steps.forEach((s, k) => {
        if (!s || typeof s.title !== "string" || !s.title) problems.push(`${where}, "${t.name}", step ${k + 1} needs a "title".`);
        else if (!STATUSES.includes(s.status)) problems.push(`"${s.title}" has status "${s.status}"; use ${STATUS_LIST}.`);
      });
    });
  });
  return problems;
}

// ---- Summaries ----

const zeroShare = () => ({ done: 0, review: 0, doing: 0 });
const zeroCounts = () => ({ total: 0, done: 0, review: 0, doing: 0, blocked: 0, todo: 0 });
const percentOf = (share) => Math.round((share.done + share.review + share.doing) * 100);

// Contribution of each status to progress, kept apart so bars can colour them.
function stepShare(steps) {
  const share = zeroShare();
  if (!steps.length) return share;
  for (const s of steps) if (s.status in share) share[s.status] += WORTH[s.status] / steps.length;
  return share;
}

function weighted(items, weightOf) {
  const total = items.reduce((a, x) => a + weightOf(x), 0);
  const share = zeroShare();
  if (!total) return share;
  for (const x of items) for (const k of Object.keys(share)) share[k] += (x.share[k] * weightOf(x)) / total;
  return share;
}

// Status of a group from its members' statuses.
function derive(statuses, explicitBlock) {
  if (explicitBlock || statuses.includes("blocked")) return "blocked";
  if (!statuses.length || statuses.every((s) => s === "todo")) return "todo";
  if (statuses.every((s) => s === "done")) return "done";
  if (statuses.every((s) => s === "done" || s === "review")) return "review";
  return "doing";
}

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function summarize(data) {
  const counts = { steps: zeroCounts(), tasks: zeroCounts(), milestones: zeroCounts() };
  const milestones = data.milestones.map((m) => {
    const tasks = m.tasks.map((t) => {
      for (const s of t.steps) { counts.steps.total++; counts.steps[s.status]++; }
      const share = stepShare(t.steps);
      const status = derive(t.steps.map((s) => s.status), text(t.blocked));
      const reasons = [text(t.blocked), ...t.steps.filter((s) => s.status === "blocked").map((s) => `${s.title}: ${text(s.reason) || "no reason given"}`)].filter(Boolean);
      counts.tasks.total++; counts.tasks[status]++;
      const questions = Array.isArray(t.questions) ? t.questions : [];
      return {
        name: t.name, status, reasons, share, percent: percentOf(share), complete: status === "done",
        steps: t.steps.length, stepsDone: t.steps.filter((s) => s.status === "done").length,
        questions: questions.length, openQuestions: questions.filter(needsUser).length,
      };
    });
    const share = weighted(tasks, () => 1);
    const status = derive(tasks.map((t) => t.status), text(m.blocked));
    const reasons = [text(m.blocked), ...tasks.flatMap((t) => t.reasons.map((r) => `${t.name}: ${r}`))].filter(Boolean);
    counts.milestones.total++; counts.milestones[status]++;
    return { id: m.id, name: m.name, when: m.when, weight: typeof m.weight === "number" ? m.weight : 1, status, reasons, share, percent: percentOf(share), complete: status === "done", tasks };
  });
  const share = weighted(milestones, (m) => m.weight);
  return {
    title: data.title, updated: data.updated, share, percent: percentOf(share), counts,
    current: milestones.find((m) => !m.complete) || null, milestones,
  };
}

// ---- Finding and changing ----

const norm = (s) => String(s).trim().toLowerCase();

function pick(list, ref, label, nameOf, context) {
  if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
    const item = list[Number(ref) - 1];
    if (!item) throw new Error(`No ${label} number ${ref}${context}.`);
    return item;
  }
  const exact = list.filter((x) => norm(nameOf(x)) === norm(ref));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`There is more than one ${label} called "${ref}"${context}; use its number instead.`);
  const partial = list.filter((x) => norm(nameOf(x)).includes(norm(ref)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${ref}" matches more than one ${label}${context}: ${partial.map(nameOf).join(", ")}.`);
  throw new Error(`No ${label} "${ref}"${context}.`);
}

export function findMilestone(data, ref) {
  return pick(data.milestones, ref, "milestone", (m) => m.id, "");
}

export function findTask(data, { milestone, task }) {
  const m = findMilestone(data, milestone);
  return { milestone: m, task: pick(m.tasks, task, "task", (t) => t.name, ` in ${m.id}`) };
}

export function findStep(data, { milestone, task, step }) {
  const found = findTask(data, { milestone, task });
  return { ...found, step: pick(found.task.steps, step, "step", (s) => s.title, ` in "${found.task.name}"`) };
}

const today = () => new Date().toISOString().slice(0, 10);

// Apply a status to a step object in place; blocked needs a reason, other statuses drop it.
export function applyStatus(step, status, reason) {
  if (!STATUSES.includes(status)) throw new Error(`Status "${status}" is not allowed; use ${STATUS_LIST}.`);
  if (status === "blocked") {
    if (!text(reason)) throw new Error("A blocked step needs a reason: what is it waiting for?");
    step.status = status;
    step.reason = text(reason);
  } else {
    step.status = status;
    delete step.reason;
  }
}

export function setStatus(data, { milestone, task, step, status, reason }, date = today()) {
  const found = findStep(data, { milestone, task, step });
  const previous = found.step.status;
  applyStatus(found.step, status, reason);
  data.updated = date;
  return { milestone: found.milestone.id, task: found.task.name, step: found.step.title, previous, status, reason: found.step.reason };
}

export function addStep(data, { milestone, task, title, status = "todo", reason }, date = today()) {
  if (!title || !String(title).trim()) throw new Error("A step needs a title.");
  const m = findMilestone(data, milestone);
  let t = m.tasks.find((x) => norm(x.name) === norm(task));
  const step = { status: "todo", title: String(title).trim() };
  applyStatus(step, status, reason);
  if (t?.steps.some((s) => norm(s.title) === norm(title))) throw new Error(`Step "${title}" already exists in "${t.name}".`);
  if (!t) m.tasks.push(t = { name: String(task).trim(), steps: [] });
  t.steps.push(step);
  data.updated = date;
  return { milestone: m.id, task: t.name, step: step.title, status };
}

export function addQuestion(data, { milestone, task, question }, date = today()) {
  if (!text(question)) throw new Error("A question needs some text.");
  const found = findTask(data, { milestone, task });
  const list = found.task.questions || (found.task.questions = []);
  if (list.some((q) => norm(q.q) === norm(question))) throw new Error(`That question was already asked in "${found.task.name}".`);
  list.push({ q: text(question) });
  data.updated = date;
  return { milestone: found.milestone.id, task: found.task.name, question: text(question), number: list.length };
}

// An answer recorded by an agent stays open for the user until they confirm it.
export const needsUser = (q) => !text(q.a) || q.by === "agent";

export function answerQuestion(data, { milestone, task, question, answer, by = "user" }, date = today()) {
  if (!text(answer)) throw new Error("An answer needs some text.");
  const found = findTask(data, { milestone, task });
  const q = pick(found.task.questions || [], question, "question", (x) => x.q, ` in "${found.task.name}"`);
  q.a = text(answer);
  if (by === "agent") q.by = "agent"; else delete q.by;
  data.updated = date;
  return { milestone: found.milestone.id, task: found.task.name, question: q.q, answer: q.a, by };
}

// ---- Reading and writing the file ----

export function parse(value) {
  return JSON.parse(value.replace(/^﻿/, ""));
}

// Standard two-space JSON, except each plain step (status, title, optional reason) sits on one
// line so diffs stay small. PHP and Python servers use the same pattern.
export const STEP_LINE = /\{\n\s+"status": ("[a-z]+"),\n\s+"title": ("(?:[^"\\]|\\.)*")(?:,\n\s+"reason": ("(?:[^"\\]|\\.)*"))?\n\s+\}/g;

export function format(data) {
  return JSON.stringify(data, null, 2)
    .replace(STEP_LINE, (_, s, t, r) => `{ "status": ${s}, "title": ${t}${r ? `, "reason": ${r}` : ""} }`) + "\n";
}

// ---- Linked documents ----

// Every document path the file links (project, milestones, tasks), without "#anchor", with
// forward slashes. Servers only serve these.
export function linkedDocs(data) {
  const all = [data.docs, ...data.milestones.flatMap((m) => [m?.docs, ...(Array.isArray(m?.tasks) ? m.tasks : []).map((t) => t?.docs)])];
  const paths = new Set();
  for (const list of all) {
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      const p = typeof d === "string" ? d : d?.path;
      if (typeof p === "string" && p.trim()) paths.add(p.split("#")[0].trim().replace(/\\/g, "/").replace(/^\.\//, ""));
    }
  }
  return paths;
}

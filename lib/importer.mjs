// Import: turn a Markdown document into a plan (milestone → tasks → steps), and merge a plan
// into a progress file. Merging matches milestones by id, tasks by name and steps by title
// (ignoring case), adds only what is missing and never changes an existing step.
import fs from "node:fs";
import path from "node:path";
import { parse, STATUSES, validate } from "./progress.mjs";

export const MAX_SOURCE = 2 * 1024 * 1024;

// A plan from a file inside the project: a .json plan as it is, or a Markdown document (which
// needs the milestone to put its tasks in). The real path must stay inside the project, so a
// link cannot pull in a file from elsewhere.
export function planFromFile(root, source, { milestone, name, bullets = false } = {}) {
  const file = path.resolve(root, source);
  const inside = (base, f) => { const rel = path.relative(base, f); return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel); };
  if (!inside(root, file)) throw new Error(`${source} must be inside the project, so its sections can be linked.`);
  if (!fs.existsSync(file)) throw new Error(`No file ${source}.`);
  if (!inside(fs.realpathSync.native(root), fs.realpathSync.native(file))) throw new Error(`${source} must be inside the project, so its sections can be linked.`);
  if (fs.statSync(file).size > MAX_SOURCE) throw new Error(`${source} is larger than 2 MB.`);
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  if (/\.json$/i.test(file)) return parse(text);
  if (typeof milestone !== "string" || !milestone.trim()) throw new Error("Name the milestone to add the tasks to: --milestone <id> (it is created when it does not exist; --name sets its name).");
  return planFromMarkdown(text, { file: path.relative(root, file).replace(/\\/g, "/"), milestone, name, bullets });
}

const norm = (s) => String(s ?? "").trim().toLowerCase();
const plain = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Heading anchors exactly as the dashboard's reader (web/markdown.js) makes them: lower case,
// only letters, digits, spaces and hyphens, spaces to hyphens; repeats get -1, -2, …
export function headingAnchors(text) {
  const used = new Map();
  const out = [];
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
    if (fence) continue;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    const title = h[2].replace(/[*_`]/g, "");
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    out.push({ level: h[1].length, title: plain(title), anchor: n ? `${base}-${n}` : base });
  }
  return out;
}

// Each heading of level 2 or more with checklist items under it becomes a task; the items
// (nested ones too) become its steps, "[x]" done and "[ ]" not started. With `bullets`, plain
// and numbered list items become steps as well. Code blocks are skipped.
export function planFromMarkdown(text, { file, milestone, name, bullets = false }) {
  const anchors = headingAnchors(text);
  const tasks = [];
  const names = new Map();
  let current = null, headingIndex = -1, fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
    if (fence) continue;
    if (/^#{1,6}\s+/.test(line)) {
      const h = anchors[++headingIndex];
      current = null;
      if (h.level < 2) continue;
      const count = (names.get(norm(h.title)) || 0) + 1;
      names.set(norm(h.title), count);
      current = { name: count > 1 ? `${h.title} (${count})` : h.title, docs: [{ title: h.title, path: `${file}#${h.anchor}` }], steps: [] };
      tasks.push(current);
      continue;
    }
    if (!current) continue;
    const box = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$/);
    const item = !box && bullets ? line.match(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(.+)$/) : null;
    if (box) current.steps.push({ status: box[1] === " " ? "todo" : "done", title: plain(box[2]) });
    else if (item) current.steps.push({ status: "todo", title: plain(item[1]) });
  }
  return { milestones: [{ id: milestone, name: name || milestone, tasks: tasks.filter((t) => t.steps.length) }] };
}

function checkShape(plan) {
  if (!plan || !Array.isArray(plan.milestones)) throw new Error('A plan needs a "milestones" list.');
  for (const m of plan.milestones) {
    if (!m || typeof m.id !== "string" || !m.id.trim()) throw new Error('Each milestone in the plan needs an "id".');
    if (!Array.isArray(m.tasks)) throw new Error(`Milestone "${m.id}" in the plan needs a "tasks" list.`);
    for (const t of m.tasks) {
      if (!t || typeof t.name !== "string" || !t.name.trim()) throw new Error(`Each task in "${m.id}" needs a "name".`);
      if (!Array.isArray(t.steps)) throw new Error(`Task "${t.name}" needs a "steps" list.`);
      for (const s of t.steps) {
        if (!s || typeof s.title !== "string" || !s.title.trim()) throw new Error(`Each step in "${t.name}" needs a "title".`);
        if (s.status !== undefined && !STATUSES.includes(s.status)) throw new Error(`"${s.title}" has status "${s.status}"; use ${STATUSES.join(", ")}.`);
      }
    }
  }
}

const docKey = (d) => norm(typeof d === "string" ? d : d?.path);

// Merge a plan into the data in place. The result is checked as a whole first: a plan that
// would make the file invalid changes nothing. Returns what was added and how many items of
// the plan were already there, with a line per addition for previews.
export function mergePlan(data, plan, date = new Date().toISOString().slice(0, 10)) {
  checkShape(plan);
  const next = structuredClone(data);
  const added = { milestones: 0, tasks: 0, steps: 0 };
  const lines = [];
  let kept = 0;
  for (const pm of plan.milestones) {
    let m = next.milestones.find((x) => norm(x.id) === norm(pm.id));
    const before = lines.length;
    if (!m) {
      m = { id: pm.id.trim(), name: plain(pm.name) || pm.id.trim() };
      for (const k of ["when", "weight", "exit", "docs"]) if (pm[k] !== undefined) m[k] = pm[k];
      m.tasks = [];
      next.milestones.push(m);
      added.milestones++;
    }
    const isNew = !data.milestones.some((x) => norm(x.id) === norm(pm.id));
    for (const pt of pm.tasks) {
      let t = m.tasks.find((x) => norm(x.name) === norm(pt.name));
      const taskLine = lines.length;
      if (!t) {
        t = { name: plain(pt.name) };
        for (const k of ["type", "tags", "docs"]) if (pt[k] !== undefined) t[k] = pt[k];
        t.steps = [];
        m.tasks.push(t);
        added.tasks++;
        lines.push(`  + ${t.name}`);
      } else {
        const have = new Set((t.docs || []).map(docKey));
        const missing = (pt.docs || []).filter((d) => !have.has(docKey(d)));
        if (missing.length) t.docs = [...(t.docs || []), ...missing];
      }
      for (const ps of pt.steps) {
        if (t.steps.some((s) => norm(s.title) === norm(ps.title))) { kept++; continue; }
        t.steps.push({ status: ps.status || "todo", title: plain(ps.title) });
        added.steps++;
        // New steps in a task that is already there: name the task once.
        if (lines.length === taskLine) lines.push(`  ~ ${t.name}`);
        lines.push(`      + ${plain(ps.title)}${ps.status && ps.status !== "todo" ? ` (${ps.status})` : ""}`);
      }
    }
    if (lines.length > before) lines.splice(before, 0, `${isNew ? "+ " : ""}${m.id} ${m.name}${isNew ? " (new milestone)" : ""}`);
  }
  const problems = validate(next);
  if (problems.length) throw new Error(`The plan can't be added: ${problems.join(" ")}`);
  if (added.milestones + added.tasks + added.steps > 0) {
    next.updated = date;
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, next);
  }
  return { added, kept, lines };
}

// "2 tasks and 5 steps", leaving out what is zero.
export function countText({ milestones, tasks, steps }) {
  const parts = [[milestones, "milestone"], [tasks, "task"], [steps, "step"]]
    .filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "nothing";
}

// What an import would add (a preview) or added, for people and agents.
export function importReport({ added, kept, lines }, applied, howToApply = "") {
  const keptText = kept ? `${kept} step${kept === 1 ? " is" : "s are"} already in the plan` : "";
  if (!added.milestones && !added.tasks && !added.steps) return `Nothing new to add${keptText ? `; ${keptText}` : ""}.`;
  if (applied) return `Added ${countText(added)}.`;
  return [`Would add ${countText(added)}:`, ...lines, "", `${keptText ? `${keptText} and stay as they are. ` : ""}${howToApply}`.trim()].join("\n");
}

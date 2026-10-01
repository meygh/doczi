// Import: turn a Markdown document into a plan (milestone → tasks → steps), and merge a plan
// into a progress file. Merging matches milestones by id, tasks by name and steps by title
// (ignoring case), adds only what is missing and never changes an existing step; an existing
// task may gain links to documents it did not have.
import fs from "node:fs";
import path from "node:path";
import { parse, STATUSES, validate } from "./progress.mjs";
import { clean } from "./report.mjs";

export const MAX_SOURCE = 2 * 1024 * 1024;
// A plan is bounded, so a merge (which holds the progress lock) stays short.
export const LIMITS = { milestones: 50, tasks: 500, steps: 500, totalSteps: 5000, text: 300, exit: 1000, docs: 20 };
const MILESTONE_ID = /^[\p{L}\p{N}._-]{1,30}$/u;

// Control, zero-width and direction characters never reach the file, a terminal or an agent.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
const plain = (s) => String(s ?? "").replace(/\s+/g, " ").replace(HIDDEN, "").trim();
const cut = (s, max = LIMITS.text) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
const norm = (s) => plain(s).toLowerCase();

// A plan from a file inside the project: a .json plan as it is, or a Markdown document (which
// needs the milestone to put its tasks in). The file is resolved once and read through the
// opened handle; links are refused, so nothing outside the project is read.
export function planFromFile(root, source, { milestone, name, bullets = false } = {}) {
  const shown = clean(source, 160);
  const file = path.resolve(root, source);
  const inside = (base, f) => { const rel = path.relative(base, f); return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel); };
  const outside = new Error(`${shown} must be inside the project, so its sections can be linked.`);
  if (!inside(root, file)) throw outside;
  let link;
  try { link = fs.lstatSync(file).isSymbolicLink(); } catch { throw new Error(`No file ${shown}.`); }
  if (link) throw new Error(`${shown} is a link; doczi imports only files that are in the project itself.`);
  const real = fs.realpathSync.native(file);
  if (!inside(fs.realpathSync.native(root), real)) throw outside;
  const fd = fs.openSync(real, "r");
  let text;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${shown} is not a file.`);
    if (stat.size > MAX_SOURCE) throw new Error(`${shown} is larger than 2 MB.`);
    text = fs.readFileSync(fd, "utf8").replace(/^﻿/, "");
  } finally { fs.closeSync(fd); }
  if (/\.json$/i.test(real)) {
    // The parser's message can quote the file; say only that it is not a plan.
    try { return parse(text); } catch { throw new Error(`${shown} is not a valid JSON plan.`); }
  }
  if (typeof milestone !== "string" || !milestone.trim()) throw new Error("Name the milestone to add the tasks to: --milestone <id> (it is created when it does not exist; --name sets its name).");
  return planFromMarkdown(text, { file: path.relative(root, file).replace(/\\/g, "/"), milestone, name, bullets });
}

// "## Title ##" → { level: 2, text: "Title" }. Written without a regex that could backtrack: a
// heading line can be as long as the whole document. A closing run of # is dropped only when a
// space comes before it, so "C#" keeps its name. web/markdown.js mirrors this.
export function splitHeading(line) {
  let level = 0;
  while (level < line.length && line[level] === "#") level++;
  if (level < 1 || level > 6 || (line[level] !== " " && line[level] !== "\t")) return null;
  let text = line.slice(level).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end === 0) text = "";
  else if (end < text.length && (text[end - 1] === " " || text[end - 1] === "\t")) text = text.slice(0, end).trimEnd();
  return { level, text };
}

// Heading anchors exactly as the dashboard's reader makes them: lower case, only letters,
// digits, spaces and hyphens, spaces to hyphens; repeats get -1, -2, …
export function headingAnchors(text) {
  const used = new Map();
  const out = [];
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
    if (fence) continue;
    const h = splitHeading(line);
    if (!h) continue;
    const title = h.text.replace(/[*_`]/g, "");
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    out.push({ level: h.level, title: cut(plain(title)), anchor: n ? `${base}-${n}` : base });
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
    if (splitHeading(line)) {
      const h = anchors[++headingIndex];
      current = null;
      if (h.level < 2 || !h.title) continue;
      const count = (names.get(norm(h.title)) || 0) + 1;
      names.set(norm(h.title), count);
      current = { name: cut(count > 1 ? `${h.title} (${count})` : h.title), docs: [{ title: h.title, path: `${file}#${h.anchor}` }], steps: [] };
      tasks.push(current);
      continue;
    }
    if (!current) continue;
    const box = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$/);
    const item = !box && bullets ? line.match(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(.+)$/) : null;
    const title = cut(plain(box ? box[2] : item ? item[1] : ""));
    if (!title) continue;
    current.steps.push({ status: box && box[1] !== " " ? "done" : "todo", title });
  }
  return { milestones: [{ id: milestone, name: name || milestone, tasks: tasks.filter((t) => t.steps.length) }] };
}

// ---- Checking a plan ----

const isText = (v) => typeof v === "string" && Boolean(plain(v));
function text(value, what, max = LIMITS.text) {
  if (!isText(value)) throw new Error(`${what} needs a text.`);
  if (plain(value).length > max) throw new Error(`${what} is longer than ${max} characters.`);
  return plain(value);
}
function optionalText(value, what, max = LIMITS.text) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${what} must be text.`);
  if (plain(value).length > max) throw new Error(`${what} is longer than ${max} characters.`);
  return plain(value) || undefined;
}
function docsOf(value, what) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > LIMITS.docs) throw new Error(`${what}: "docs" must be a list of at most ${LIMITS.docs} documents.`);
  return value.map((d) => {
    const p = typeof d === "string" ? d : d?.path;
    if (typeof p !== "string" || !p.trim() || p.length > 500) throw new Error(`${what}: each document needs a "path".`);
    const title = d && typeof d === "object" && isText(d.title) ? cut(plain(d.title)) : undefined;
    return { ...(title ? { title } : {}), path: p.trim() };
  });
}

// A checked copy of the plan with only the fields doczi knows, so nothing an agent or a file
// adds slips into the progress file. Content rules (types, tags, document paths) are left to
// validate(), which runs on the merged result.
function checkedPlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.milestones)) throw new Error('A plan needs a "milestones" list.');
  if (plan.milestones.length > LIMITS.milestones) throw new Error(`A plan can have at most ${LIMITS.milestones} milestones.`);
  let totalSteps = 0;
  return plan.milestones.map((m, i) => {
    if (!m || typeof m !== "object") throw new Error(`Milestone ${i + 1} in the plan is not an object.`);
    if (typeof m.id !== "string" || !MILESTONE_ID.test(m.id.trim())) throw new Error(`Milestone ${i + 1} needs an "id" of up to 30 letters, digits, dots, hyphens or underscores.`);
    const id = m.id.trim();
    const where = `Milestone ${clean(id, 30)}`;
    if (!Array.isArray(m.tasks)) throw new Error(`${where} needs a "tasks" list.`);
    if (m.tasks.length > LIMITS.tasks) throw new Error(`${where} can have at most ${LIMITS.tasks} tasks.`);
    if (m.weight !== undefined && !(typeof m.weight === "number" && Number.isFinite(m.weight) && m.weight >= 0)) throw new Error(`${where}: "weight" must be a number of 0 or more.`);
    return {
      id, name: optionalText(m.name, `${where}: "name"`), when: optionalText(m.when, `${where}: "when"`),
      exit: optionalText(m.exit, `${where}: "exit"`, LIMITS.exit), weight: m.weight, docs: docsOf(m.docs, where),
      tasks: m.tasks.map((t, j) => {
        if (!t || typeof t !== "object") throw new Error(`${where}, task ${j + 1} is not an object.`);
        const name = text(t.name, `${where}, task ${j + 1}`);
        const tw = `${where}, "${clean(name, 60)}"`;
        if (!Array.isArray(t.steps)) throw new Error(`${tw} needs a "steps" list.`);
        if (t.steps.length > LIMITS.steps) throw new Error(`${tw} can have at most ${LIMITS.steps} steps.`);
        totalSteps += t.steps.length;
        if (totalSteps > LIMITS.totalSteps) throw new Error(`A plan can have at most ${LIMITS.totalSteps} steps.`);
        if (t.tags !== undefined && !(Array.isArray(t.tags) && t.tags.every((x) => typeof x === "string"))) throw new Error(`${tw}: "tags" must be a list of texts.`);
        return {
          name, type: t.type === undefined ? undefined : String(t.type), tags: t.tags ? [...t.tags] : undefined, docs: docsOf(t.docs, tw),
          steps: t.steps.map((s, k) => {
            const title = text(s?.title, `${tw}, step ${k + 1}`);
            if (s.status !== undefined && !STATUSES.includes(s.status)) throw new Error(`${tw}: step ${k + 1} has status "${clean(s.status, 20)}"; use ${STATUSES.join(", ")}.`);
            return { status: s.status || "todo", title };
          }),
        };
      }),
    };
  });
}

const docKey = (d) => norm(typeof d === "string" ? d : d?.path);
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Merge a plan into the data in place. The result is checked as a whole first: a plan that
// would make the file invalid changes nothing. Returns what was added and how many steps of
// the plan were already there, with a line per addition for previews.
export function mergePlan(data, plan, date = new Date().toISOString().slice(0, 10)) {
  const milestones = checkedPlan(plan);
  const next = structuredClone(data);
  const added = { milestones: 0, tasks: 0, steps: 0 };
  const lines = [];
  let kept = 0;
  const byId = new Map(next.milestones.map((m) => [norm(m.id), m]));
  const existed = new Set(data.milestones.map((m) => norm(m.id)));
  for (const pm of milestones) {
    let m = byId.get(norm(pm.id));
    const before = lines.length;
    if (!m) {
      m = { ...defined({ id: pm.id, name: pm.name || pm.id, when: pm.when, weight: pm.weight, exit: pm.exit, docs: pm.docs }), tasks: [] };
      next.milestones.push(m);
      byId.set(norm(m.id), m);
      added.milestones++;
    }
    const isNew = !existed.has(norm(pm.id));
    const byName = new Map(m.tasks.map((t) => [norm(t.name), t]));
    for (const pt of pm.tasks) {
      let t = byName.get(norm(pt.name));
      const taskLine = lines.length;
      if (!t) {
        t = { ...defined({ name: pt.name, type: pt.type, tags: pt.tags, docs: pt.docs }), steps: [] };
        m.tasks.push(t);
        byName.set(norm(t.name), t);
        added.tasks++;
        lines.push(`  + ${clean(t.name)}`);
      } else if (pt.docs) {
        const have = new Set((t.docs || []).map(docKey));
        const missing = pt.docs.filter((d) => !have.has(docKey(d)));
        if (missing.length) t.docs = [...(t.docs || []), ...missing];
      }
      const titles = new Set(t.steps.map((s) => norm(s.title)));
      for (const ps of pt.steps) {
        if (titles.has(norm(ps.title))) { kept++; continue; }
        t.steps.push({ status: ps.status, title: ps.title });
        titles.add(norm(ps.title));
        added.steps++;
        // New steps in a task that is already there: name the task once.
        if (lines.length === taskLine) lines.push(`  ~ ${clean(t.name)}`);
        lines.push(`      + ${clean(ps.title, 160)}${ps.status !== "todo" ? ` (${ps.status})` : ""}`);
      }
    }
    if (lines.length > before) lines.splice(before, 0, `${isNew ? "+ " : ""}${clean(m.id, 30)} ${clean(m.name)}${isNew ? " (new milestone)" : ""}`);
  }
  const problems = validate(next);
  if (problems.length) throw new Error(clean(`The plan can't be added: ${problems.join(" ")}`, 600));
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

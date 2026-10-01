// Markdown and CSV exports of a progress file. One copy, shared by the dashboard (a classic
// script, like markdown.js) and the CLI (lib/export.mjs runs this file). Percentages and
// statuses come in as `stats`, worked out by the caller with the project's progress rules:
// { percent, stepsDone, stepsTotal, milestones: [{ percent, status, tasks: [{ percent, status }] }] }
(function (global) {
  "use strict";

  const LABELS = { done: "Done", review: "Waiting for your check", doing: "In progress", blocked: "Blocked", todo: "Not started" };
  const TYPE_LABELS = {
    feature: "Feature", bug: "Bug", issue: "Issue", refinement: "Refinement", redesign: "Redesign",
    chore: "Chore", docs: "Docs", research: "Research", security: "Security",
  };
  const line = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const typeLabel = (t) => (Object.hasOwn(TYPE_LABELS, t.type) ? TYPE_LABELS[t.type] : "");
  const tagsOf = (t) => (Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === "string" && x) : []);
  const docsOf = (list) => (Array.isArray(list) ? list : [])
    .map((d) => (typeof d === "string" ? { path: d } : d))
    .filter((d) => d && typeof d.path === "string");

  // ---- Markdown ----

  // Project text is shown as text: characters that would start emphasis, code, links or HTML
  // are escaped.
  const md = (v) => line(v).replace(/[\\`*_[\]<>]/g, "\\$&");
  const docLines = (list) => {
    const docs = docsOf(list);
    return docs.length ? [`Documents: ${docs.map((d) => (d.title ? `${md(d.title)} (${md(d.path)})` : md(d.path))).join(" · ")}`, ""] : [];
  };

  function markdown(data, stats) {
    const out = [`# ${md(data.title || "Project progress")}`, ""];
    if (line(data.subtitle)) out.push(md(data.subtitle), "");
    out.push(`${data.updated ? `Updated ${md(data.updated)} · ` : ""}${stats.percent}% overall · ${stats.stepsDone} of ${stats.stepsTotal} steps done`, "");
    out.push(...docLines(data.docs));
    data.milestones.forEach((m, mi) => {
      const ms = stats.milestones[mi];
      out.push(`## ${md(m.id)} ${md(m.name)}: ${ms.percent}% (${LABELS[ms.status]})`, "");
      const about = [line(m.when) && `When: ${md(m.when)}`, line(m.exit) && `Done when: ${md(m.exit)}`].filter(Boolean);
      if (about.length) out.push(about.join(" · "), "");
      if (line(m.blocked)) out.push(`Blocked: ${md(m.blocked)}`, "");
      out.push(...docLines(m.docs));
      (m.tasks || []).forEach((t, ti) => {
        const ts = ms.tasks[ti];
        out.push(`### ${md(t.name)}: ${ts.percent}% (${LABELS[ts.status]})`, "");
        const labels = [typeLabel(t) && `Type: ${typeLabel(t)}`, tagsOf(t).length && `Tags: ${tagsOf(t).map(md).join(", ")}`].filter(Boolean);
        if (labels.length) out.push(labels.join(" · "), "");
        if (line(t.blocked)) out.push(`Blocked: ${md(t.blocked)}`, "");
        out.push(...docLines(t.docs));
        if (!t.steps.length) out.push("No steps yet.", "");
        else {
          for (const s of t.steps) {
            const note = s.status === "blocked" ? ` (Blocked: ${md(s.reason) || "no reason given"})`
              : s.status === "done" || s.status === "todo" ? "" : ` (${LABELS[s.status]})`;
            out.push(`- [${s.status === "done" ? "x" : " "}] ${md(s.title)}${note}`);
          }
          out.push("");
        }
        if (line(t.note)) out.push(md(t.note), "");
        const questions = Array.isArray(t.questions) ? t.questions : [];
        if (questions.length) {
          out.push("Questions:", "");
          for (const q of questions) {
            const answer = line(q.a) ? `${md(q.a)}${q.by === "agent" ? " (recorded by an agent, not yet confirmed)" : ""}` : "(no answer yet)";
            out.push(`- Q: ${md(q.q)}`, `  A: ${answer}`);
          }
          out.push("");
        }
      });
    });
    return out.join("\n").replace(/\n+$/, "") + "\n";
  }

  // ---- CSV ----

  const COLUMNS = ["Milestone ID", "Milestone", "Task", "Type", "Tags", "Task status", "Task progress", "Step", "Step status", "Reason"];
  // A cell starting with =, +, -, @, a tab or a carriage return can run as a formula when the
  // file is opened in a spreadsheet; a leading apostrophe keeps it as text.
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function csv(data, stats) {
    const rows = [COLUMNS];
    data.milestones.forEach((m, mi) => {
      (m.tasks || []).forEach((t, ti) => {
        const ts = stats.milestones[mi].tasks[ti];
        const task = [m.id, m.name, t.name, typeLabel(t), tagsOf(t).join(" "), LABELS[ts.status], ts.percent];
        if (!t.steps.length) rows.push([...task, "", "", ""]);
        for (const s of t.steps) rows.push([...task, s.title, LABELS[s.status], s.status === "blocked" ? line(s.reason) : ""]);
      });
    });
    // A byte order mark, so spreadsheets read the file as UTF-8.
    return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  }

  global.docziExport = { markdown, csv };
})(typeof window !== "undefined" ? window : globalThis);

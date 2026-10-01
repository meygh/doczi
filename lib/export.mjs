// Exports for the CLI. The Markdown and CSV writers live in web/export.js so the dashboard and
// the CLI share one copy; this module runs that file and feeds it this library's progress rules.
import fs from "node:fs";
import vm from "node:vm";
import { format, summarize } from "./progress.mjs";

const context = {};
vm.runInNewContext(fs.readFileSync(new URL("../web/export.js", import.meta.url), "utf8"), context);
const { markdown, csv } = context.docziExport;

export const FORMATS = { md: "md", csv: "csv", json: "json" };

export function statsOf(data) {
  const s = summarize(data);
  return {
    percent: s.percent, stepsDone: s.counts.steps.done, stepsTotal: s.counts.steps.total,
    milestones: s.milestones.map((m) => ({ percent: m.percent, status: m.status, tasks: m.tasks.map((t) => ({ percent: t.percent, status: t.status })) })),
  };
}

export const toMarkdown = (data) => markdown(data, statsOf(data));
export const toCsv = (data) => csv(data, statsOf(data));
export const toJson = (data) => format(data);

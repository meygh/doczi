#!/usr/bin/env node
// keel MCP server (stdio, newline-delimited JSON-RPC 2.0). No dependencies.
// Agents use it to read and update a project's progress and to fetch keel rules.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { RULE_MODULES } from "../lib/config.mjs";
import { addQuestion, addStep, answerQuestion, setStatus, STATUSES } from "../lib/progress.mjs";
import { get as getProject, list as listProjects } from "../lib/registry.mjs";
import { DATA_LABEL, listText, summaryText } from "../lib/report.mjs";
import { openProject, readProgress, updateProgress } from "../lib/store.mjs";

// Writes may reach only the project this server runs in, or projects the user registered.
// An agent steered by injected text cannot aim them at an arbitrary folder.
function writableProject(ref) {
  const project = openProject(ref);
  const here = openProject();
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  if (!ref || same(project.root, here.root) || getProject(ref) || listProjects().some((p) => same(p.path, project.root))) return project;
  throw new Error(`Writes go only to the current project or registered projects; register this one first with "keel projects add ${project.root}".`);
}

const root = fileURLToPath(new URL("..", import.meta.url));

// Tool arguments are not validated against inputSchema by the protocol; check them here.
function knownModule(name) {
  if (!RULE_MODULES.includes(name)) throw new Error(`No rule module "${name}". Choose from ${RULE_MODULES.join(", ")}.`);
  return name;
}
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

const project = { type: "string", description: "Registered project id or a path. Default: the current project." };
const ref = (d) => ({ type: ["string", "integer"], description: d });

const TOOLS = [
  {
    name: "progress_summary",
    description: "Overall and per-milestone progress, what is in progress and what is next.",
    inputSchema: { type: "object", properties: { project } },
    run: (a) => `${DATA_LABEL}

${summaryText(readProgress(openProject(a.project)))}`,
  },
  {
    name: "progress_list",
    description: "Every task and step with its status and number, for one milestone or all.",
    inputSchema: { type: "object", properties: { project, milestone: { type: "string", description: "Milestone id, e.g. M0. Default: all." } } },
    run: (a) => `${DATA_LABEL}

${listText(readProgress(openProject(a.project)), a.milestone)}`,
  },
  {
    name: "progress_set_status",
    description: "Set a step's status: doing when you start it, review when your part is done and the user should check it, done once checked (or when the project check passes and no check is needed), blocked with a reason when you cannot continue, todo to reset. Refer to task and step by name, a unique part of the name, or 1-based number.",
    inputSchema: {
      type: "object",
      required: ["milestone", "task", "step", "status"],
      properties: {
        project, milestone: { type: "string" }, task: ref("Task name or number"), step: ref("Step title or number"),
        status: { type: "string", enum: STATUSES },
        reason: { type: "string", description: "Required for blocked: what the step is waiting for." },
      },
    },
    run: (a) => {
      const r = updateProgress(writableProject(a.project), (d) => setStatus(d, a));
      return `${r.milestone} › ${r.task} › ${r.step}: ${r.previous} → ${r.status}${r.reason ? ` (${r.reason})` : ""}`;
    },
  },
  {
    name: "progress_ask",
    description: "Record a question for the user on a task, when you need a decision you should not make yourself. The user answers it in the dashboard or chat.",
    inputSchema: {
      type: "object",
      required: ["milestone", "task", "question"],
      properties: { project, milestone: { type: "string" }, task: ref("Task name or number"), question: { type: "string" } },
    },
    run: (a) => {
      const r = updateProgress(writableProject(a.project), (d) => addQuestion(d, a));
      return `Asked on ${r.milestone} › ${r.task} (question ${r.number}): ${r.question}`;
    },
  },
  {
    name: "progress_answer",
    description: "Record an answer to a question on a task, as the user told it to you. It is marked as recorded by the agent and stays in the user's list until they confirm it.",
    inputSchema: {
      type: "object",
      required: ["milestone", "task", "question", "answer"],
      properties: { project, milestone: { type: "string" }, task: ref("Task name or number"), question: ref("Question text or number"), answer: { type: "string" } },
    },
    run: (a) => {
      const r = updateProgress(writableProject(a.project), (d) => answerQuestion(d, { ...a, by: "agent" }));
      return `Recorded on ${r.milestone} › ${r.task}: ${r.question} → ${r.answer} (waiting for the user to confirm)`;
    },
  },
  {
    name: "progress_add_step",
    description: "Add a step to a task (the task is created when it does not exist).",
    inputSchema: {
      type: "object",
      required: ["milestone", "task", "title"],
      properties: { project, milestone: { type: "string" }, task: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: STATUSES } },
    },
    run: (a) => {
      const r = updateProgress(writableProject(a.project), (d) => addStep(d, a));
      return `Added "${r.step}" (${r.status}) to ${r.milestone} › ${r.task}.`;
    },
  },
  {
    name: "projects_list",
    description: "Projects registered with keel (id, name, path).",
    inputSchema: { type: "object", properties: {} },
    run: () => listProjects().map((p) => `${p.id}  ${p.name}  ${p.path}`).join("\n") || "No projects registered. Run \"keel init\" in a project.",
  },
  {
    name: "rules_get",
    description: `The text of a keel rule module: ${RULE_MODULES.join(", ")}. Default: all.`,
    inputSchema: { type: "object", properties: { module: { type: "string", enum: RULE_MODULES } } },
    run: (a) => (a.module ? [knownModule(a.module)] : RULE_MODULES).map((m) => fs.readFileSync(path.join(root, "rules", `${m}.md`), "utf8").trim()).join("\n\n"),
  },
];

function handle(msg) {
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
        capabilities: { tools: {} },
        serverInfo: { name: "keel", version },
        instructions: "Project progress (milestones → tasks → steps) and keel working rules. Keep step statuses current as you work.",
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(({ run, ...t }) => t) };
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) throw Object.assign(new Error(`Unknown tool ${params.name}`), { code: -32602 });
      try { return { content: [{ type: "text", text: tool.run(params.arguments || {}) }] }; }
      catch (err) { return { content: [{ type: "text", text: err.message }], isError: true }; }
    }
    default:
      if (id === undefined) return undefined; // notifications need no answer
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: "Parse error" } }); }
  try {
    const result = handle(msg);
    if (msg.id !== undefined && result !== undefined) send({ id: msg.id, result });
  } catch (err) {
    if (msg.id !== undefined) send({ id: msg.id, error: { code: err.code || -32603, message: err.message } });
  }
});

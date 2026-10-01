import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../mcp/server.mjs", import.meta.url));
let proc, lines, project, nextId = 1;
const pending = new Map();

function call(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve) => pending.set(id, resolve));
}
const tool = async (name, args = {}) => (await call("tools/call", { name, arguments: args })).result;

before(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-mcp-"));
  fs.mkdirSync(path.join(project, ".git"));
  fs.mkdirSync(path.join(project, "docs", "progress"), { recursive: true });
  fs.writeFileSync(path.join(project, "docs/progress/milestones.json"), JSON.stringify({
    title: "Demo",
    milestones: [{ id: "M0", name: "Start", tasks: [{ name: "Setup", steps: [{ status: "todo", title: "Repo" }, { status: "todo", title: "CI" }] }] }],
  }));
  proc = spawn(process.execPath, [server], { cwd: project, env: { ...process.env, DOCZI_HOME: path.join(project, ".home") } });
  lines = readline.createInterface({ input: proc.stdout });
  lines.on("line", (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); });
});
after(() => proc.kill());

test("initialize answers with server info and tool capability, echoing the protocol version", async () => {
  const r = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.ok(r.result.capabilities.tools);
  assert.equal(r.result.serverInfo.name, "doczi");
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});

test("tools/list describes every tool with an input schema", async () => {
  const { result } = await call("tools/list", {});
  const names = result.tools.map((t) => t.name);
  assert.deepEqual(names.sort(), ["progress_add_step", "progress_answer", "progress_ask", "progress_list", "progress_set_status", "progress_summary", "projects_list", "rules_get"]);
  for (const t of result.tools) assert.equal(t.inputSchema.type, "object");
});

test("progress tools read and change the project file in the working folder", async () => {
  let r = await tool("progress_summary");
  assert.match(r.content[0].text, /Demo: 0% overall/);
  r = await tool("progress_set_status", { milestone: "M0", task: "setup", step: "repo", status: "done" });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /Repo: todo → done/);
  const saved = JSON.parse(fs.readFileSync(path.join(project, "docs/progress/milestones.json"), "utf8"));
  assert.equal(saved.milestones[0].tasks[0].steps[0].status, "done");
  r = await tool("progress_add_step", { milestone: "M0", task: "Setup", title: "Docs" });
  assert.match(r.content[0].text, /Added/);
  r = await tool("progress_set_status", { milestone: "M0", task: 1, step: "CI", status: "blocked" });
  assert.equal(r.isError, true);
  r = await tool("progress_set_status", { milestone: "M0", task: 1, step: "CI", status: "blocked", reason: "No runner yet" });
  assert.match(r.content[0].text, /todo → blocked \(No runner yet\)/);
  r = await tool("progress_ask", { milestone: "M0", task: 1, question: "Which CI service?" });
  assert.match(r.content[0].text, /question 1/);
  r = await tool("progress_answer", { milestone: "M0", task: 1, question: 1, answer: "GitHub Actions" });
  assert.match(r.content[0].text, /GitHub Actions/);
  r = await tool("progress_list", { milestone: "M0" });
  assert.match(r.content[0].text, /\[!\] 2\. CI — blocked: No runner yet/);
  assert.match(r.content[0].text, /Q1\. Which CI service\? → GitHub Actions/);
  assert.match(r.content[0].text, /\[x\] 1\. Repo/);
  assert.match(r.content[0].text, /\[ \] 3\. Docs/);
});

test("tool errors come back as isError results, not protocol errors", async () => {
  const r = await tool("progress_set_status", { milestone: "M9", task: "x", step: "y", status: "done" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No milestone "M9"/);
});

test("rules_get returns a rule module; unknown methods get a JSON-RPC error", async () => {
  assert.match((await tool("rules_get", { module: "clean-code" })).content[0].text, /# Clean code/);
  assert.equal((await call("nope/nothing", {})).error.code, -32601);
  assert.deepEqual((await call("ping", {})).result, {});
});

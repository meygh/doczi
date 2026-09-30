// Regression tests for the second security review.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { normalizePath, patchesIn, filesInPatch } from "../lib/ai-terms.mjs";
import { answerQuestion, validate } from "../lib/progress.mjs";
import { listText } from "../lib/report.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keel-sec2-")); process.env.KEEL_HOME = path.join(tmp, "home"); });

const canSymlink = (() => {
  const probe = path.join(os.tmpdir(), `keel-link2-${process.pid}`);
  try { fs.symlinkSync(path.join(os.tmpdir(), "nowhere"), probe, "file"); fs.unlinkSync(probe); return true; } catch { return false; }
})();

// ---- H-A: the Markdown renderer never lets text escape an attribute or become markup.
function markdown() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(repo, "web/markdown.js"), "utf8"), ctx);
  return ctx.window.keelMarkdown;
}

test("markdown keeps link targets and titles inside their attributes", () => {
  const { render } = markdown();
  const attacks = [
    "[x](#<https://e/popover/id=p>)",
    "[x](#<https://e/onmouseover=location=/javascript:alert%281%29/.source//>)",
    '[x](docs/a.md "t<https://e/x>")',
    "[<img src=x onerror=alert(1)>](https://e)",
    "<https://e/\"onmouseover=\"alert(1)>",
    "[x](javascript:alert(1))",
    "`<script>`[x](https://e/`a`)",
    "# <b onclick=1>hi</b>",
    "| a | b |\n| --- | --- |\n| <img> | [y](#\"x) |",
  ];
  for (const src of attacks) {
    const html = render(src, { linked: new Set(["docs/a.md"]) }).html;
    // Every tag is one of ours, and no attribute value contains a raw quote or angle bracket.
    for (const tag of html.match(/<[^>]*>/g) || []) {
      assert.match(tag, /^<\/?(a|p|code|span|strong|em|del|h1|table|thead|tbody|tr|th|td|pre|ul|ol|li|input)\b/, `${src} → ${tag}`);
      for (const [, value] of tag.matchAll(/="([^"]*)"/g)) assert.doesNotMatch(value, /[<>"]/, `${src} → ${tag}`);
      assert.doesNotMatch(tag, /\son\w+=/i, `${src} → ${tag}`);
    }
    assert.doesNotMatch(html, /href="javascript:/i);
  }
});

test("markdown still renders links, anchors, code and emphasis", () => {
  const { render } = markdown();
  const html = render("See [the **goals**](#goals), <https://example.com> and `a<b`.", {}).html;
  assert.match(html, /<a href="#" data-anchor="goals">the <strong>goals<\/strong><\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">https:\/\/example\.com<\/a>/);
  assert.match(html, /<code>a&lt;b<\/code>/);
});

test("the page carries its own CSP for file mode", () => {
  assert.match(fs.readFileSync(path.join(repo, "web/index.html"), "utf8"), /http-equiv="Content-Security-Policy" content="default-src 'self'/);
});

// ---- H-B: keel init never writes through a symlink.
test("init refuses a dangling symlink where it would write", { skip: canSymlink ? false : "symlinks need extra rights here" }, () => {
  const dir = path.join(tmp, "init-link");
  fs.mkdirSync(path.join(dir, "docs", "progress"), { recursive: true });
  spawnSync("git", ["init", "-q", dir]);
  const target = path.join(tmp, "outside-target.txt");
  fs.symlinkSync(target, path.join(dir, "docs", "progress", "milestones.json"), "file");
  const r = spawnSync(process.execPath, [path.join(repo, "cli/keel.mjs"), "init", "--no-register"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /symbolic link/);
  assert.equal(fs.existsSync(target), false);
});

// ---- M-A, M-B: every patch block and padded markers are checked.
test("patchesIn finds every block and filesInPatch tolerates padded markers", () => {
  const cmd = "apply_patch <<'A'\n*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch\nA\napply_patch <<'B'\n*** Begin Patch\n *** Add File: .env\n+S=1\n*** End Patch\nB";
  const blocks = patchesIn(cmd);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.flatMap(filesInPatch), ["a.txt", ".env"]);
});

function hook(script, cwd, tool_name, tool_input) {
  return spawnSync(process.execPath, [path.join(repo, "hooks", script)], { input: JSON.stringify({ cwd, tool_name, tool_input }), encoding: "utf8" });
}

test("a second patch in one command cannot write a protected file", () => {
  const dir = path.join(tmp, "multi");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  const cmd = "apply_patch <<'A'\n*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch\nA\napply_patch <<'B'\n*** Begin Patch\n  *** Add File: .env\n+S=1\n*** End Patch\nB";
  assert.equal(hook("pre-bash.mjs", dir, "Bash", { command: cmd }).status, 2);
});

// ---- M-C: a nested repo's config cannot switch off the outer project's checks.
test("a nested .keel.json does not disable the session project's guard", () => {
  const outer = path.join(tmp, "outer");
  const inner = path.join(outer, "vendor", "lib");
  fs.mkdirSync(path.join(outer, ".git"), { recursive: true });
  fs.mkdirSync(path.join(inner, ".git"), { recursive: true });
  fs.writeFileSync(path.join(inner, ".keel.json"), JSON.stringify({ protect: [], aiFootprint: { check: false } }));
  // The agent works in the nested repo but writes the outer project's .env.
  assert.equal(hook("pre-edit.mjs", inner, "Write", { file_path: path.join(outer, ".env"), content: "S=1" }).status, 2);
  // And a file inside the outer project is still checked for AI mentions.
  assert.equal(hook("pre-edit.mjs", inner, "Write", { file_path: path.join(outer, "src", "a.js"), content: "// by claude" }).status, 2);
});

// ---- M-D: answers recorded by an agent stay open for the user.
test("an agent's answer is marked and still needs the user", () => {
  const d = { milestones: [{ id: "M0", name: "A", tasks: [{ name: "T", steps: [], questions: [{ q: "Which CI?" }] }] }] };
  answerQuestion(d, { milestone: "M0", task: 1, question: 1, answer: "Jenkins", by: "agent" });
  assert.deepEqual(d.milestones[0].tasks[0].questions[0], { q: "Which CI?", a: "Jenkins", by: "agent" });
  assert.match(listText(d), /not confirmed by the user/);
  answerQuestion(d, { milestone: "M0", task: 1, question: 1, answer: "GitHub Actions" });
  assert.deepEqual(d.milestones[0].tasks[0].questions[0], { q: "Which CI?", a: "GitHub Actions" });
});

test("MCP answers are recorded as the agent's; rules_get only serves rule modules", async () => {
  const dir = path.join(tmp, "mcp");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "progress"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs/progress/milestones.json"), JSON.stringify({ milestones: [{ id: "M0", name: "A", tasks: [{ name: "T", steps: [], questions: [{ q: "Which CI?" }] }] }] }));
  const proc = spawn(process.execPath, [path.join(repo, "mcp/server.mjs")], { cwd: dir });
  const lines = readline.createInterface({ input: proc.stdout });
  const pending = new Map();
  lines.on("line", (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); });
  let id = 0;
  const call = (name, args) => new Promise((resolve) => { pending.set(++id, resolve); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n"); });
  const answer = await call("progress_answer", { milestone: "M0", task: 1, question: 1, answer: "Jenkins" });
  assert.match(answer.result.content[0].text, /waiting for the user to confirm/);
  const rule = await call("rules_get", { module: "../docs/API" });
  proc.kill();
  assert.equal(rule.result.isError, true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "docs/progress/milestones.json"), "utf8"));
  assert.equal(saved.milestones[0].tasks[0].questions[0].by, "agent");
});

// ---- Low: path spellings and document paths.
test("more Windows path aliases normalize to the real file", () => {
  assert.equal(normalizePath("\\\\[::1]\\d$\\Repo\\.env"), "d:/repo/.env");
  assert.equal(normalizePath("\\\\MYPC\\D$\\Repo\\.env"), "d:/repo/.env");
  assert.equal(normalizePath("D:\\Repo\\server.key."), "d:/repo/server.key");
  assert.equal(normalizePath("D:\\Repo\\c.key  "), "d:/repo/c.key");
  assert.equal(normalizePath("D:\\Repo\\..\\x"), "d:/repo/../x");
});

test("document paths may not contain a colon", () => {
  const d = { docs: [{ path: "docs/a.md:hidden.md" }], milestones: [] };
  assert.match(validate(d).join(" "), /":"/);
  assert.deepEqual(validate({ docs: [{ path: "docs/a.md#part:2" }], milestones: [] }), []);
});

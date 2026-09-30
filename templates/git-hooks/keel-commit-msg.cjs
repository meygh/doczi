// keel commit-msg hook: removes assistant attribution (co-author trailers, "generated with"
// footers), then refuses the commit if the message still mentions an AI tool or vendor.
// Standalone on purpose: it keeps working when keel moves or updates.
// Turn it off for one repo with "aiFootprint": { "check": false } in .keel.json.
const fs = require("fs");
const path = require("path");

const TERMS = [
  "\\b(claude|anthropic|chatgpt|openai|copilot|codex|gemini|gpt-?[0-9][a-z0-9.-]*)\\b",
  "(generated|written|created|authored) (by|with|using) (an )?(ai|llm)\\b",
  "\\bai-generated\\b",
  "^\\s*(co-authored-by|claude-session):.*(noreply@|bot\\b|assistant)",
  "^\\s*🤖"
];

const file = process.argv[2];
if (!file) process.exit(0);

let extra = [];
try {
  const root = require("child_process").execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  const config = JSON.parse(fs.readFileSync(path.join(root, ".keel.json"), "utf8").replace(/^﻿/, ""));
  if (config.aiFootprint && config.aiFootprint.check === false) process.exit(0);
  extra = (config.aiFootprint && config.aiFootprint.terms) || [];
} catch (e) { /* no .keel.json: defaults */ }

const kept = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) =>
  !/^\s*co-authored-by:.*(claude|anthropic|openai|chatgpt|copilot|codex|gemini|noreply@anthropic\.com)/i.test(line) &&
  !/generated with \[?(claude|codex|chatgpt|copilot)/i.test(line) &&
  !/^\s*claude-session:/i.test(line) &&
  !/^\s*🤖/.test(line));
while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
const message = kept.join("\n") + "\n";
fs.writeFileSync(file, message);

const patterns = TERMS.concat(extra).map((t) => new RegExp(t, "i"));
const hits = message.split("\n").filter((line) => !line.startsWith("#") && patterns.some((re) => re.test(line)));
if (hits.length) {
  process.stderr.write("commit-msg: the message mentions an AI tool or vendor. Rewrite these lines:\n" + hits.map((l) => "  " + l).join("\n") + "\n");
  process.exit(1);
}

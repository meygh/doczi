#!/usr/bin/env node
// doczi command line. Run "doczi help" for the commands.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowed, scanText } from "../lib/ai-terms.mjs";
import { configFile as findConfigFile, DEFAULT_CONFIG, findRoot, loadConfig, RULE_MODULES } from "../lib/config.mjs";
import { CONFIG_FILE, env, home, LEGACY_CONFIG_FILE, legacyHome } from "../lib/names.mjs";
import { addQuestion, addStep, answerQuestion, format, labelTask, labelText, parse, setStatus, TASK_TYPES } from "../lib/progress.mjs";
import { list, register, unregister } from "../lib/registry.mjs";
import { clean, listText, summaryText } from "../lib/report.mjs";
import { toCsv, toJson, toMarkdown } from "../lib/export.mjs";
import { importReport, mergePlan, planFromFile } from "../lib/importer.mjs";
import { occupied } from "../lib/fsutil.mjs";
import { assertInside, openProject, readProgress, updateProgress, writeFileAtomic } from "../lib/store.mjs";

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_FILES = ["index.html", "app.js", "markdown.js", "export.js", "theme.js", "style.css"];

const HELP = `doczi — working rules, skills and progress tracking for your projects

Usage: doczi <command> [options]

  init [dir]                 Set up doczi in a project: .doczi.json, a starter progress file,
                             and registration with the dashboard. Never overwrites files.
      --name <name>  --check "<command>"  --progress <path>
      --rules core,clean-code,no-ai-footprint,delegation | --no-rules
      --page                 Also copy the dashboard page next to the progress file
      --no-register          Do not add the project to the dashboard
  progress                   Summary: overall, per milestone, in progress, next up
      --all | --milestone <id>   List steps with their numbers
      set <milestone> <task> <step> <status> [--reason "…"]
                             status: done, review (waiting for a check), doing,
                             blocked (needs --reason) or todo
      add <milestone> <task> "<step title>" [--status doing]
      label <milestone> <task> [--type <type>|none] [--add a,b] [--remove c] [--tags a,b]
                             type: feature, bug, issue, refinement, redesign, chore,
                             docs, research or security; tags: lower case, no spaces
      ask <milestone> <task> "<question>"
      answer <milestone> <task> <question number or text> "<answer>"
      --project <id|path>    Another project than the current one
  import <file>              Add tasks and steps from a document; shows them first
      --milestone <id>       Milestone for a Markdown file's tasks (created if new)
      --name "<name>"        Its name, when it is new
      --bullets              Plain list items become steps too, not only "- [ ]"
      --write                Add them (without it, nothing is written)
                             A .json file is a plan: { "milestones": [ … ] }
  export                     Write the plan to a new file (never over an existing one)
      --format md|csv|json   Default md
      --out <file>|-         Default <title>-progress-<date>.<format>; - prints it
      --project <id|path>    Another project than the current one
  check-ai [files…]          Find AI tool or vendor mentions (default: all tracked files)
  git-hooks [dir]            Install the commit-msg hook that strips assistant attribution
  migrate [dir]              Move a project set up before the rename: rename its config file
                             and copy the project list. Never overwrites files.
  projects                   List registered projects
      add <path> | remove <id>
  serve [options]            Start the dashboard (menu: Node.js, PHP or Python)
      --runtime node|php|python  --port <n>  --no-open  --yes
  mcp                        Run the MCP server on stdio (agents use this)
  help                       This text

Tasks and steps can be named by title, a unique part of the title, or 1-based number.`;

// ---- tiny argument parser ----
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) out.flags[key] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") && !["page", "no-register", "no-rules", "all", "yes", "no-open", "open", "self", "staged", "write", "bullets"].includes(key)) out.flags[key] = argv[++i];
      else out.flags[key] = true;
    } else out._.push(a);
  }
  return out;
}

const say = (...lines) => console.log(lines.join("\n"));
class UsageError extends Error {}

// ---- commands ----
function init(args) {
  const root = path.resolve(args._[0] || findRoot(process.cwd()));
  if (!fs.existsSync(root)) throw new UsageError(`No folder ${root}.`);
  const configFile = findConfigFile(root).file;
  const name = args.flags.name || path.basename(root);
  const report = [];

  // Create a new file inside the project without ever writing through a symlink (a cloned
  // repo may contain dangling links that point elsewhere). Returns false when it already exists.
  const create = (file, content) => {
    if (occupied(file)) {
      if (fs.lstatSync(file).isSymbolicLink()) throw new UsageError(`${path.relative(root, file)} is a symbolic link; doczi will not write through it.`);
      return false;
    }
    try { assertInside(root, file); } catch { throw new UsageError(`${path.relative(root, file)} would land outside the project; doczi will not write it.`); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    assertInside(root, file);
    writeFileAtomic(file, content);
    return true;
  };

  if (occupied(configFile) && !fs.lstatSync(configFile).isSymbolicLink()) {
    report.push(`Kept the existing ${path.basename(configFile)}.`);
  } else {
    const rules = args.flags["no-rules"] ? false
      : typeof args.flags.rules === "string" ? args.flags.rules.split(",").map((s) => s.trim()).filter(Boolean) : RULE_MODULES;
    const unknown = Array.isArray(rules) ? rules.filter((r) => !RULE_MODULES.includes(r)) : [];
    if (unknown.length) throw new UsageError(`Unknown rule module(s): ${unknown.join(", ")}. Choose from ${RULE_MODULES.join(", ")}.`);
    const config = {
      name,
      check: typeof args.flags.check === "string" ? args.flags.check : "",
      progress: typeof args.flags.progress === "string" ? args.flags.progress : DEFAULT_CONFIG.progress,
      rules,
      aiFootprint: { check: true, allow: [], terms: [] },
      protect: DEFAULT_CONFIG.protect,
    };
    create(configFile, JSON.stringify(config, null, 2) + "\n");
    report.push("Created .doczi.json.");
  }

  const project = openProject(root);
  const data = parse(fs.readFileSync(path.join(PACKAGE_ROOT, "templates/progress/milestones.example.json"), "utf8"));
  data.title = `${clean(project.config.name, 80)}: where we are`;
  data.updated = new Date().toISOString().slice(0, 10);
  delete data.$schema;
  if (create(project.progressPath, format(data))) report.push(`Created a starter progress file (${project.config.progress}); replace its milestones with yours.`);
  else report.push(`Kept the existing progress file (${project.config.progress}).`);

  if (args.flags.page) {
    const dir = path.dirname(project.progressPath);
    for (const f of [...WEB_FILES, "progress.schema.json"]) {
      const to = path.join(dir, f);
      const source = fs.readFileSync(path.join(PACKAGE_ROOT, f === "progress.schema.json" ? "templates/progress" : "web", f), "utf8");
      if (!create(to, source)) report.push(`Kept ${path.relative(root, to)}.`);
    }
    report.push(`Copied the dashboard page into ${path.relative(root, dir) || "."} (serve that folder, or use "doczi serve").`);
  }

  if (!args.flags["no-register"]) report.push(`Registered as "${register(root, project.config.name).id}" for the dashboard.`);
  say(...report, "", 'Next: "doczi progress" to see where you stand, "doczi serve" for the dashboard, "doczi git-hooks" for commit messages.');
}

function progress(args) {
  const project = openProject(args.flags.project);
  const [sub, ...rest] = args._;
  if (sub === "set") {
    const [milestone, task, step, status] = rest;
    if (!status) throw new UsageError('Usage: doczi progress set <milestone> <task> <step> <done|review|doing|blocked|todo> [--reason "…"]');
    const reason = typeof args.flags.reason === "string" ? args.flags.reason : undefined;
    const r = updateProgress(project, (d) => setStatus(d, { milestone, task, step, status, reason }));
    return say(`${r.milestone} › ${r.task} › ${r.step}: ${r.previous} → ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  }
  if (sub === "ask") {
    const [milestone, task, question] = rest;
    if (!question) throw new UsageError('Usage: doczi progress ask <milestone> <task> "<question>"');
    const r = updateProgress(project, (d) => addQuestion(d, { milestone, task, question }));
    return say(`Asked on ${r.milestone} › ${r.task} (question ${r.number}): ${r.question}`);
  }
  if (sub === "answer") {
    const [milestone, task, question, answer] = rest;
    if (!answer) throw new UsageError('Usage: doczi progress answer <milestone> <task> <question number or text> "<answer>"');
    const r = updateProgress(project, (d) => answerQuestion(d, { milestone, task, question, answer }));
    return say(`Answered on ${r.milestone} › ${r.task}: ${r.question} → ${r.answer}`);
  }
  if (sub === "add") {
    const [milestone, task, title] = rest;
    if (!title) throw new UsageError('Usage: doczi progress add <milestone> <task> "<step title>" [--status doing]');
    const r = updateProgress(project, (d) => addStep(d, { milestone, task, title, status: args.flags.status || "todo" }));
    return say(`Added "${r.step}" (${r.status}) to ${r.milestone} › ${r.task}.`);
  }
  if (sub === "label") {
    const [milestone, task] = rest;
    const list = (flag) => (typeof args.flags[flag] === "string" ? args.flags[flag].split(",").filter((x) => x.trim()) : undefined);
    const type = typeof args.flags.type === "string" ? args.flags.type : undefined;
    if (!task || (type === undefined && !list("tags") && !list("add") && !list("remove"))) {
      throw new UsageError(`Usage: doczi progress label <milestone> <task> [--type ${TASK_TYPES.join("|")}|none] [--add a,b] [--remove c] [--tags a,b]`);
    }
    const r = updateProgress(project, (d) => labelTask(d, { milestone, task, type, tags: list("tags"), add: list("add") || [], remove: list("remove") || [] }));
    return say(`${r.milestone} › ${r.task.name}: ${labelText(r.task) || "no type or tags"}`);
  }
  if (sub) throw new UsageError(`Unknown progress command "${sub}". Use set, add, ask, answer or label, or nothing for the summary.`);
  const data = readProgress(project);
  if (args.flags.all || args.flags.milestone) return say(listText(data, typeof args.flags.milestone === "string" ? args.flags.milestone : undefined));
  say(summaryText(data));
}

const EXPORTERS = { md: toMarkdown, csv: toCsv, json: toJson };

// Read a Markdown document (or a JSON plan) into tasks and steps; show what would be added,
// and add it only with --write.
function importPlan(args) {
  const [source] = args._;
  if (!source) throw new UsageError("Usage: doczi import <file.md> --milestone <id> [--name \"…\"] [--bullets] [--write]\n       doczi import <plan.json> [--write]");
  const project = openProject(args.flags.project);
  const plan = planFromFile(project.root, path.resolve(source), {
    milestone: typeof args.flags.milestone === "string" ? args.flags.milestone : undefined,
    name: typeof args.flags.name === "string" ? args.flags.name : undefined,
    bullets: args.flags.bullets === true,
  });
  if (!args.flags.write) return say(importReport(mergePlan(structuredClone(readProgress(project)), plan), false, "Run again with --write to add them."));
  say(importReport(updateProgress(project, (d) => mergePlan(d, plan)), true));
}

function exportPlan(args) {
  const kind = typeof args.flags.format === "string" ? args.flags.format.toLowerCase() : "md";
  if (!Object.hasOwn(EXPORTERS, kind)) throw new UsageError(`Unknown format "${args.flags.format}"; use md, csv or json.`);
  const data = readProgress(openProject(args.flags.project));
  const text = EXPORTERS[kind](data);
  if (args.flags.out === "-") return process.stdout.write(text);
  const slug = String(data.title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60);
  const out = typeof args.flags.out === "string" ? args.flags.out : `${slug ? slug + "-" : ""}progress-${new Date().toISOString().slice(0, 10)}.${kind}`;
  try { fs.writeFileSync(path.resolve(out), text, { flag: "wx" }); }
  catch (err) {
    if (err.code === "EEXIST") throw new UsageError(`${out} already exists; doczi never overwrites. Choose another name with --out.`);
    throw err;
  }
  say(`Wrote ${out}.`);
}

function checkAi(args) {
  const root = findRoot(process.cwd());
  const config = loadConfig(root);
  let files = args._;
  if (!files.length) {
    const git = spawnSync("git", ["ls-files", ...(args.flags.staged ? ["--cached", "--modified"] : [])], { cwd: root, encoding: "utf8" });
    if (git.status !== 0) throw new UsageError("Not a git repository; name the files to check.");
    files = git.stdout.split("\n").filter(Boolean);
  }
  let found = 0;
  for (const f of files) {
    const abs = path.resolve(root, f);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory() || isAllowed(abs, root, config.aiFootprint.allow)) continue;
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) continue; // binary
    for (const hit of scanText(buf.toString("utf8"), config.aiFootprint.terms)) {
      found++;
      say(`${path.relative(root, abs).replace(/\\/g, "/")}:${hit.line}: ${hit.text}`);
    }
  }
  if (found) {
    console.error(`\n${found} mention(s) of AI tools or vendors. Rewrite them, or list the path in .doczi.json → aiFootprint.allow if it must name them.`);
    process.exitCode = 1;
  } else if (args.flags.self || process.stdout.isTTY) {
    say("No AI tool or vendor mentions found.");
  }
}

function gitHooks(args) {
  const root = path.resolve(args._[0] || findRoot(process.cwd()));
  const git = spawnSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: root, encoding: "utf8" });
  if (git.status !== 0) throw new UsageError(`${root} is not a git repository.`);
  const hooksDir = path.resolve(root, git.stdout.trim());
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(path.join(PACKAGE_ROOT, "templates/git-hooks/doczi-commit-msg.cjs"), path.join(hooksDir, "doczi-commit-msg.cjs"));
  const hook = path.join(hooksDir, "commit-msg");
  const managed = /# (doczi|solo-keel)-managed commit-msg hook/; // solo-keel: legacy marker, replaced
  if (fs.existsSync(hook) && !managed.test(fs.readFileSync(hook, "utf8"))) {
    return say(
      `${path.relative(root, hook)} already has a commit-msg hook, so it was left alone.`,
      "To add doczi's check, put this line near its top:",
      `  node "$(dirname "$0")/doczi-commit-msg.cjs" "$1" || exit 1`,
    );
  }
  fs.copyFileSync(path.join(PACKAGE_ROOT, "templates/git-hooks/commit-msg"), hook);
  fs.chmodSync(hook, 0o755);
  fs.rmSync(path.join(hooksDir, "solo-keel-commit-msg.cjs"), { force: true }); // legacy script
  say(`Installed the commit-msg hook in ${path.relative(root, hooksDir) || hooksDir}.`, "Commit messages now lose assistant attribution lines, and mentions of AI tools are refused.");
}

// Until v0.3: move a project and the project list from the legacy names to the new ones.
function migrate(args) {
  const root = path.resolve(args._[0] || findRoot(process.cwd()));
  const legacyConfig = path.join(root, LEGACY_CONFIG_FILE);
  const config = path.join(root, CONFIG_FILE);
  const report = [];
  if (occupied(legacyConfig)) {
    if (fs.lstatSync(legacyConfig).isSymbolicLink()) throw new UsageError(`${LEGACY_CONFIG_FILE} is a symbolic link; doczi will not move it.`);
    if (occupied(config)) throw new UsageError(`${CONFIG_FILE} already exists next to ${LEGACY_CONFIG_FILE}; merge them by hand, then delete ${LEGACY_CONFIG_FILE}.`);
    // Link, then unlink: unlike rename, a link never replaces a file that appeared meanwhile.
    try { fs.linkSync(legacyConfig, config); }
    catch (err) {
      if (err.code === "EEXIST") throw new UsageError(`${CONFIG_FILE} appeared while migrating; nothing was changed.`);
      fs.copyFileSync(legacyConfig, config, fs.constants.COPYFILE_EXCL);
    }
    fs.unlinkSync(legacyConfig);
    report.push(`Renamed ${LEGACY_CONFIG_FILE} to ${CONFIG_FILE}.`);
  }
  const legacyRegistry = path.join(legacyHome(), "projects.json");
  const registry = path.join(home(), "projects.json");
  if (!env("HOME") && fs.existsSync(legacyRegistry) && !fs.existsSync(home())) {
    fs.mkdirSync(home(), { recursive: true });
    fs.copyFileSync(legacyRegistry, registry, fs.constants.COPYFILE_EXCL);
    report.push(`Copied the project list to ${registry}; ${legacyRegistry} is left as it was.`);
  }
  if (!report.length) return say("Nothing to migrate.");
  say(...report, "", 'Run "doczi git-hooks" too if this project uses the commit-msg hook.');
}

function projects(args) {
  const [sub, value] = args._;
  if (sub === "add") {
    if (!value) throw new UsageError("Usage: doczi projects add <path>");
    const root = findRoot(path.resolve(value));
    const p = register(root, loadConfig(root).name);
    return say(`Registered "${p.id}" (${p.path}).`);
  }
  if (sub === "remove") {
    if (!value) throw new UsageError("Usage: doczi projects remove <id>");
    return say(unregister(value) ? `Removed "${value}".` : `No project "${value}".`);
  }
  if (sub) throw new UsageError(`Unknown projects command "${sub}". Use add or remove, or nothing to list.`);
  const all = list();
  if (!all.length) return say('No projects registered yet. Run "doczi init" inside a project.');
  const width = Math.max(...all.map((p) => p.id.length));
  say(...all.map((p) => `${p.id.padEnd(width)}  ${p.name}  ${p.path}`));
}

function serve(argv) {
  const [cmd, args] = process.platform === "win32"
    ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PACKAGE_ROOT, "serve.ps1"), ...toPsArgs(argv)]]
    : ["bash", [path.join(PACKAGE_ROOT, "serve"), ...argv]];
  spawn(cmd, args, { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
}

// "--runtime php --no-open" → "-Runtime php -NoOpen" for the PowerShell launcher.
function toPsArgs(argv) {
  const names = { runtime: "-Runtime", port: "-Port", "no-open": "-NoOpen", open: "-Open", yes: "-Yes", y: "-Yes" };
  return argv.map((a) => (a.startsWith("-") ? names[a.replace(/^-+/, "")] || a : a));
}

// ---- main ----
const [command = "help", ...rest] = process.argv.slice(2);
try {
  switch (command) {
    case "init": init(parseArgs(rest)); break;
    case "progress": progress(parseArgs(rest)); break;
    case "import": importPlan(parseArgs(rest)); break;
    case "export": exportPlan(parseArgs(rest)); break;
    case "check-ai": checkAi(parseArgs(rest)); break;
    case "git-hooks": gitHooks(parseArgs(rest)); break;
    case "migrate": migrate(parseArgs(rest)); break;
    case "projects": projects(parseArgs(rest)); break;
    case "serve": serve(rest); break;
    case "mcp": await import("../mcp/server.mjs"); break;
    case "help": case "--help": case "-h": say(HELP); break;
    default: throw new UsageError(`Unknown command "${command}". Run "doczi help".`);
  }
} catch (err) {
  console.error(err instanceof UsageError || !env("DEBUG") ? err.message : err.stack);
  process.exitCode = 1;
}

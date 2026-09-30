#!/usr/bin/env node
// keel command line. Run "keel help" for the commands.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowed, scanText } from "../lib/ai-terms.mjs";
import { DEFAULT_CONFIG, findRoot, loadConfig, RULE_MODULES } from "../lib/config.mjs";
import { addQuestion, addStep, answerQuestion, format, parse, setStatus } from "../lib/progress.mjs";
import { list, register, unregister } from "../lib/registry.mjs";
import { clean, listText, summaryText } from "../lib/report.mjs";
import { occupied } from "../lib/fsutil.mjs";
import { assertInside, openProject, readProgress, updateProgress, writeFileAtomic } from "../lib/store.mjs";

const KEEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_FILES = ["index.html", "app.js", "markdown.js", "theme.js", "style.css"];

const HELP = `keel — working rules, skills and progress tracking for your projects

Usage: keel <command> [options]

  init [dir]                 Set up keel in a project: .keel.json, a starter progress file,
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
      ask <milestone> <task> "<question>"
      answer <milestone> <task> <question number or text> "<answer>"
      --project <id|path>    Another project than the current one
  check-ai [files…]          Find AI tool or vendor mentions (default: all tracked files)
  git-hooks [dir]            Install the commit-msg hook that strips assistant attribution
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
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") && !["page", "no-register", "no-rules", "all", "yes", "no-open", "open", "self", "staged"].includes(key)) out.flags[key] = argv[++i];
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
  const configFile = path.join(root, ".keel.json");
  const name = args.flags.name || path.basename(root);
  const report = [];

  // Create a new file inside the project without ever writing through a symlink (a cloned
  // repo may contain dangling links that point elsewhere). Returns false when it already exists.
  const create = (file, content) => {
    if (occupied(file)) {
      if (fs.lstatSync(file).isSymbolicLink()) throw new UsageError(`${path.relative(root, file)} is a symbolic link; keel will not write through it.`);
      return false;
    }
    try { assertInside(root, file); } catch { throw new UsageError(`${path.relative(root, file)} would land outside the project; keel will not write it.`); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    assertInside(root, file);
    writeFileAtomic(file, content);
    return true;
  };

  if (occupied(configFile) && !fs.lstatSync(configFile).isSymbolicLink()) {
    report.push("Kept the existing .keel.json.");
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
    report.push("Created .keel.json.");
  }

  const project = openProject(root);
  const data = parse(fs.readFileSync(path.join(KEEL, "templates/progress/milestones.example.json"), "utf8"));
  data.title = `${clean(project.config.name, 80)}: where we are`;
  data.updated = new Date().toISOString().slice(0, 10);
  delete data.$schema;
  if (create(project.progressPath, format(data))) report.push(`Created a starter progress file (${project.config.progress}); replace its milestones with yours.`);
  else report.push(`Kept the existing progress file (${project.config.progress}).`);

  if (args.flags.page) {
    const dir = path.dirname(project.progressPath);
    for (const f of [...WEB_FILES, "progress.schema.json"]) {
      const to = path.join(dir, f);
      const source = fs.readFileSync(path.join(KEEL, f === "progress.schema.json" ? "templates/progress" : "web", f), "utf8");
      if (!create(to, source)) report.push(`Kept ${path.relative(root, to)}.`);
    }
    report.push(`Copied the dashboard page into ${path.relative(root, dir) || "."} (serve that folder, or use "keel serve").`);
  }

  if (!args.flags["no-register"]) report.push(`Registered as "${register(root, project.config.name).id}" for the dashboard.`);
  say(...report, "", 'Next: "keel progress" to see where you stand, "keel serve" for the dashboard, "keel git-hooks" for commit messages.');
}

function progress(args) {
  const project = openProject(args.flags.project);
  const [sub, ...rest] = args._;
  if (sub === "set") {
    const [milestone, task, step, status] = rest;
    if (!status) throw new UsageError('Usage: keel progress set <milestone> <task> <step> <done|review|doing|blocked|todo> [--reason "…"]');
    const reason = typeof args.flags.reason === "string" ? args.flags.reason : undefined;
    const r = updateProgress(project, (d) => setStatus(d, { milestone, task, step, status, reason }));
    return say(`${r.milestone} › ${r.task} › ${r.step}: ${r.previous} → ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  }
  if (sub === "ask") {
    const [milestone, task, question] = rest;
    if (!question) throw new UsageError('Usage: keel progress ask <milestone> <task> "<question>"');
    const r = updateProgress(project, (d) => addQuestion(d, { milestone, task, question }));
    return say(`Asked on ${r.milestone} › ${r.task} (question ${r.number}): ${r.question}`);
  }
  if (sub === "answer") {
    const [milestone, task, question, answer] = rest;
    if (!answer) throw new UsageError('Usage: keel progress answer <milestone> <task> <question number or text> "<answer>"');
    const r = updateProgress(project, (d) => answerQuestion(d, { milestone, task, question, answer }));
    return say(`Answered on ${r.milestone} › ${r.task}: ${r.question} → ${r.answer}`);
  }
  if (sub === "add") {
    const [milestone, task, title] = rest;
    if (!title) throw new UsageError('Usage: keel progress add <milestone> <task> "<step title>" [--status doing]');
    const r = updateProgress(project, (d) => addStep(d, { milestone, task, title, status: args.flags.status || "todo" }));
    return say(`Added "${r.step}" (${r.status}) to ${r.milestone} › ${r.task}.`);
  }
  if (sub) throw new UsageError(`Unknown progress command "${sub}". Use set, add, ask or answer, or nothing for the summary.`);
  const data = readProgress(project);
  if (args.flags.all || args.flags.milestone) return say(listText(data, typeof args.flags.milestone === "string" ? args.flags.milestone : undefined));
  say(summaryText(data));
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
    console.error(`\n${found} mention(s) of AI tools or vendors. Rewrite them, or list the path in .keel.json → aiFootprint.allow if it must name them.`);
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
  fs.copyFileSync(path.join(KEEL, "templates/git-hooks/keel-commit-msg.cjs"), path.join(hooksDir, "keel-commit-msg.cjs"));
  const hook = path.join(hooksDir, "commit-msg");
  if (fs.existsSync(hook) && !fs.readFileSync(hook, "utf8").includes("# keel-managed commit-msg hook")) {
    return say(
      `${path.relative(root, hook)} already has a commit-msg hook, so it was left alone.`,
      "To add keel's check, put this line near its top:",
      `  node "$(dirname "$0")/keel-commit-msg.cjs" "$1" || exit 1`,
    );
  }
  fs.copyFileSync(path.join(KEEL, "templates/git-hooks/commit-msg"), hook);
  fs.chmodSync(hook, 0o755);
  say(`Installed the commit-msg hook in ${path.relative(root, hooksDir) || hooksDir}.`, "Commit messages now lose assistant attribution lines, and mentions of AI tools are refused.");
}

function projects(args) {
  const [sub, value] = args._;
  if (sub === "add") {
    if (!value) throw new UsageError("Usage: keel projects add <path>");
    const root = findRoot(path.resolve(value));
    const p = register(root, loadConfig(root).name);
    return say(`Registered "${p.id}" (${p.path}).`);
  }
  if (sub === "remove") {
    if (!value) throw new UsageError("Usage: keel projects remove <id>");
    return say(unregister(value) ? `Removed "${value}".` : `No project "${value}".`);
  }
  if (sub) throw new UsageError(`Unknown projects command "${sub}". Use add or remove, or nothing to list.`);
  const all = list();
  if (!all.length) return say('No projects registered yet. Run "keel init" inside a project.');
  const width = Math.max(...all.map((p) => p.id.length));
  say(...all.map((p) => `${p.id.padEnd(width)}  ${p.name}  ${p.path}`));
}

function serve(argv) {
  const [cmd, args] = process.platform === "win32"
    ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(KEEL, "serve.ps1"), ...toPsArgs(argv)]]
    : ["bash", [path.join(KEEL, "serve"), ...argv]];
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
    case "check-ai": checkAi(parseArgs(rest)); break;
    case "git-hooks": gitHooks(parseArgs(rest)); break;
    case "projects": projects(parseArgs(rest)); break;
    case "serve": serve(rest); break;
    case "mcp": await import("../mcp/server.mjs"); break;
    case "help": case "--help": case "-h": say(HELP); break;
    default: throw new UsageError(`Unknown command "${command}". Run "keel help".`);
  }
} catch (err) {
  console.error(err instanceof UsageError || !process.env.KEEL_DEBUG ? err.message : err.stack);
  process.exitCode = 1;
}

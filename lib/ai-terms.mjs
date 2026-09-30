// "No AI footprint": find mentions of coding assistants, their vendors and attribution
// lines in code, docs and commit text. Used by the hooks, the CLI and the git hooks.

export const DEFAULT_TERMS = [
  String.raw`\b(claude|anthropic|chatgpt|openai|copilot|codex|gemini|gpt-?[0-9][a-z0-9.-]*)\b`,
  String.raw`(generated|written|created|authored) (by|with|using) (an )?(ai|llm)\b`,
  String.raw`\bai-generated\b`,
  String.raw`^\s*(co-authored-by|claude-session):.*(noreply@|bot\b|assistant)`,
  "^\\s*🤖",
];

// Files that must name tools to configure them.
export const DEFAULT_ALLOW = [
  "CLAUDE.md", "AGENTS.md", "AGENTS.override.md", ".claude/", ".codex/", ".agents/",
  ".claude-plugin/", ".codex-plugin/", ".mcp.json", ".keel.json", ".githooks/",
];

const compile = (terms) => terms.map((t) => new RegExp(t, "i"));

export function scanText(text, extraTerms = []) {
  const res = compile([...DEFAULT_TERMS, ...extraTerms]);
  const hits = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (res.some((re) => re.test(line))) hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
  });
  return hits;
}

// One spelling per path: forward slashes, Windows aliases removed (\\?\C:\, \\localhost\C$\,
// /c/ from Git Bash, NTFS streams like ".env::$DATA"), Windows paths lower-cased.
export function normalizePath(p) {
  let s = String(p).replace(/\r$/, "").replace(/\\/g, "/");
  s = s.replace(/^\/\/[?.]\/(?:unc\/)?/i, (m) => (/unc/i.test(m) ? "//" : ""));
  // Any administrative share (\\host\D$\, \\[::1]\D$\ …) points at a local drive.
  s = s.replace(/^\/\/[^/]+\/([a-z])\$\//i, (_, d) => `${d}:/`);
  s = s.replace(/^\/([a-z])\//i, (_, d) => `${d}:/`);
  const drive = /^[a-z]:\//i.test(s);
  // Drop NTFS alternate data streams (".env::$DATA" writes ".env") and the trailing dots and
  // spaces Windows ignores ("server.key." writes "server.key").
  s = s.split("/").map((seg, i) => (drive && i === 0 ? seg : seg.replace(/:.*$/, "").replace(/[. ]+$/, (m) => (seg === "." || seg === ".." ? m : "")))).join("/");
  return drive ? s.toLowerCase() : s;
}

const caseInsensitiveFs = process.platform === "win32" || process.platform === "darwin";

// The path of file relative to root, or null when it lies outside.
export function relativeTo(file, root, { caseInsensitive = caseInsensitiveFs } = {}) {
  let f = normalizePath(file);
  let r = normalizePath(root).replace(/\/$/, "") + "/";
  if (caseInsensitive) { f = f.toLowerCase(); r = r.toLowerCase(); }
  return f.startsWith(r) ? f.slice(r.length) : null;
}

export function isAllowed(file, root, allow = DEFAULT_ALLOW) {
  const rel = relativeTo(file, root);
  if (rel === null) return false;
  const lower = caseInsensitiveFs || /^[a-z]:\//.test(normalizePath(root));
  return allow.some((p) => {
    const q = lower ? normalizePath(p).toLowerCase() : normalizePath(p);
    const r = lower ? rel.toLowerCase() : rel;
    return q.endsWith("/") ? r.startsWith(q) : r === q || r.endsWith("/" + q);
  });
}

// Every file a patch touches (added, updated, deleted, or the target of a move).
// Patch markers, tolerant of padding and case (patch tools trim marker lines).
const FILE_MARKER = /^\s*\*\*\*\s*(add file|update file|delete file|move to)\s*:\s*(.+?)\s*$/i;
const BLOCK_MARKER = /^\s*\*\*\*\s*(begin patch|end patch)\b/i;

export function filesInPatch(patch) {
  return String(patch).split(/\r?\n/).map((l) => l.match(FILE_MARKER)).filter(Boolean).map((m) => m[2]);
}

// apply_patch text (Codex) → the lines it adds, with their file (a moved file counts under its new name).
export function addedLinesFromPatch(patch) {
  const out = [];
  let file = null;
  for (const line of String(patch).split(/\r?\n/)) {
    const m = line.match(FILE_MARKER);
    if (m) { file = /delete/i.test(m[1]) ? null : m[2]; continue; }
    if (BLOCK_MARKER.test(line)) { file = null; continue; }
    if (file && line.startsWith("+")) out.push({ file, text: line.slice(1) });
  }
  return out;
}

// Every patch block inside a tool input, whatever its shape (string, array, one or more heredocs).
export function patchesIn(value) {
  const text = Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : "";
  const blocks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(BLOCK_MARKER);
    if (m && /begin/i.test(m[1])) { if (current) blocks.push(current.join("\n")); current = [line]; continue; }
    if (current) {
      current.push(line);
      if (m) { blocks.push(current.join("\n")); current = null; }
    }
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}

// The command text when it creates a commit, tag or pull request; otherwise null.
export function commitTextOf(command) {
  const text = Array.isArray(command) ? command.join(" ") : String(command || "");
  return /\bgit\b[^|;&]*\b(commit|tag)\b|\bgh\s+pr\s+(create|edit)\b/.test(text) ? text : null;
}

// Remove attribution trailers and footers from a commit message.
export function stripAttribution(message) {
  const kept = String(message).split(/\r?\n/).filter((line) =>
    !/^\s*co-authored-by:.*(claude|anthropic|openai|chatgpt|copilot|codex|gemini|noreply@anthropic\.com)/i.test(line) &&
    !/generated with \[?(claude|codex|chatgpt|copilot)/i.test(line) &&
    !/^\s*claude-session:/i.test(line) &&
    !/^\s*🤖/.test(line));
  while (kept.length && kept.at(-1).trim() === "") kept.pop();
  return kept.join("\n") + "\n";
}

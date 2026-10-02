// Paths that belong to one machine have no place in files a team shares: a colleague's
// checkout lives on another drive. ownPathHits() finds this machine's project root and home
// folder (a certain mistake, so the edit hook blocks it); foreignPathHits() finds any other
// absolute path (only a hint, so the CLI warns).
import os from "node:os";

// Files that may name machine paths: the local settings and any "*.local.*" file.
export const DEFAULT_LOCAL_ALLOW = [".doczi.local.json", "**/*.local.*", ".git/**"];

const MIN_LENGTH = 5; // "/" or "c:/" is not a real folder

// One spelling: lower case, forward slashes, "/e/x" (Git Bash) as "e:/x", no repeated or final slash.
export function squash(text) {
  return String(text).toLowerCase()
    .replace(/\\+/g, "/").replace(/\/{2,}/g, "/")
    .replace(/(^|[^a-z0-9_.-])\/([a-z])\//g, "$1$2:/")
    .replace(/(?<=.)\/$/, "");
}

export function ownPaths(root, home = os.homedir(), ...more) {
  return [...new Set([root, home, ...more].filter(Boolean).map(squash))].filter((p) => p.length >= MIN_LENGTH);
}

const isPathChar = (c) => c !== undefined && /[a-z0-9_.-]/.test(c);

// [{ line, text }] for every line that names one of the paths (compare with ownPaths()).
export function ownPathHits(text, paths) {
  const hits = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const s = squash(line);
    const found = paths.some((p) => {
      for (let at = s.indexOf(p); at !== -1; at = s.indexOf(p, at + 1)) {
        if (!isPathChar(s[at - 1]) && !isPathChar(s[at + p.length])) return true;
      }
      return false;
    });
    if (found) hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
  });
  return hits;
}

const FOREIGN = [
  /\b[a-z]:[\\/]{1,2}(?![\\/])[\w.$-]/i, // C:\x, d:/x
  /(?<![\w.-])\/(?:home|Users)\/[^\s/"'\\]+/, // /home/ali, /Users/ali
  /(?<![\w.-])\/[a-z]\/Users\/[^\s/"'\\]+/, // /c/Users/ali (Git Bash)
];

export function foreignPathHits(text) {
  const hits = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (FOREIGN.some((re) => re.test(line))) hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
  });
  return hits;
}

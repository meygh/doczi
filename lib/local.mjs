// Settings that belong to one machine: .doczi.local.json, next to .doczi.json and never
// committed (doczi init adds it to .gitignore). It exists so drive letters, tool paths and
// proxies stay out of files a colleague on another machine shares.
import fs from "node:fs";
import path from "node:path";
import { LOCAL_CONFIG_FILE } from "./names.mjs";
import { clean } from "./report.mjs";

export const MAX_NOTES = 20;
export const MAX_NOTE = 300;
const MAX_BYTES = 64 * 1024;

// { check?, notes: [], error? }. A broken file never throws: it is reported and ignored.
export function loadLocal(root) {
  const file = path.join(root, LOCAL_CONFIG_FILE);
  const empty = { notes: [] };
  let stat;
  try { stat = fs.lstatSync(file); } catch { return empty; }
  // A link in a cloned repository could pull any file into an agent's context.
  if (!stat.isFile()) return { ...empty, error: `${LOCAL_CONFIG_FILE} is not a regular file; doczi ignores it.` };
  if (stat.size > MAX_BYTES) return { ...empty, error: `${LOCAL_CONFIG_FILE} is larger than 64 KB; doczi ignores it.` };
  let own;
  try { own = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); }
  catch (err) { return { ...empty, error: `${LOCAL_CONFIG_FILE} is not valid JSON (${err.message}); doczi ignores it.` }; }
  if (!own || typeof own !== "object" || Array.isArray(own)) return { ...empty, error: `${LOCAL_CONFIG_FILE} must hold a JSON object; doczi ignores it.` };
  const notes = (Array.isArray(own.notes) ? own.notes : [])
    .filter((n) => typeof n === "string").map((n) => clean(n, MAX_NOTE)).filter(Boolean).slice(0, MAX_NOTES);
  const check = typeof own.check === "string" && own.check.trim() ? own.check.trim() : undefined;
  return { ...(check ? { check } : {}), notes };
}

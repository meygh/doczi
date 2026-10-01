#!/usr/bin/env node
// doczi dashboard + REST API on Node.js. Contract: docs/API.md (same as the PHP and Python servers).
// Usage: node server/node/server.mjs [--port 4800]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyStatus, linkedDocs, parse, STATUSES } from "../../lib/progress.mjs";
import { get, list } from "../../lib/registry.mjs";
import { assertInside, openProject, readProgress, writeProgress } from "../../lib/store.mjs";
import { LockBusyError, withLockSync } from "../../lib/lock.mjs";
import { env } from "../../lib/names.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const argPort = process.argv.indexOf("--port");
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : env("PORT") || 4800);
const MAX_BODY = 64 * 1024;
const MAX_DOC = 2 * 1024 * 1024;
const MAX_REASON = 2000;
const MAX_ANSWER = 4000;
const DOC_TYPES = /\.(md|markdown|txt)$/i;
const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/markdown.js": ["markdown.js", "text/javascript; charset=utf-8"],
  "/export.js": ["export.js", "text/javascript; charset=utf-8"],
  "/theme.js": ["theme.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const CSP = "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > MAX_BODY) return reject(new HttpError(413, "The request body is too large."));
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, "The request body is too large.")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function jsonBody(req) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) throw new HttpError(415, "Send JSON (Content-Type: application/json).");
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins.has(origin)) throw new HttpError(403, "Cross-site requests are not allowed.");
  const text = await readBody(req);
  try { return JSON.parse(text) ?? {}; } catch { throw new HttpError(400, "The body is not valid JSON."); }
}

function decodeId(raw) {
  try { return decodeURIComponent(raw); } catch { throw new HttpError(400, "The project id is not valid."); }
}

function projectOrThrow(id) {
  const reg = get(id);
  if (!reg) throw new HttpError(404, `No project "${id}".`);
  try {
    const project = openProject(reg.id);
    if (!fs.existsSync(project.progressPath)) throw new Error();
    assertInside(project.root, project.progressPath);
    return project;
  } catch { throw new HttpError(404, `Project "${id}" has no progress file yet.`); }
}

function hasProgress(p) {
  try { projectOrThrow(p.id); return true; } catch { return false; }
}

const shortText = (v, max) => typeof v === "string" && v.trim() && v.length <= max;

async function patchStep(req, id) {
  const { milestone, task, step, title, status, reason } = await jsonBody(req);
  if (![milestone, task, step].every(Number.isInteger) || typeof title !== "string") throw new HttpError(400, "Send milestone, task and step as numbers and the step's title.");
  if (!STATUSES.includes(status)) throw new HttpError(400, `Status must be one of: ${STATUSES.join(", ")}.`);
  if (status === "blocked" && !shortText(reason, MAX_REASON)) throw new HttpError(400, `A blocked step needs a reason (up to ${MAX_REASON} characters).`);
  return changeLocked(projectOrThrow(id), (data) => {
    const target = data.milestones[milestone]?.tasks?.[task]?.steps?.[step];
    if (!target) throw new HttpError(404, "There is no step at that position.");
    if (target.title !== title) throw new HttpError(409, "The list changed since you loaded it. Reload and try again.");
    applyStatus(target, status, reason);
  });
}

// Read, change and write the progress file while holding its lock (other writers wait).
function changeLocked(project, change) {
  try {
    return withLockSync(project.progressPath, () => {
      const data = readProgress(project);
      change(data);
      data.updated = new Date().toISOString().slice(0, 10);
      writeProgress(project, data);
      return data;
    });
  } catch (err) {
    if (err instanceof LockBusyError) throw new HttpError(503, err.message);
    throw err;
  }
}

async function patchQuestion(req, id) {
  const { milestone, task, question, q, answer } = await jsonBody(req);
  if (![milestone, task, question].every(Number.isInteger) || typeof q !== "string") throw new HttpError(400, "Send milestone, task and question as numbers and the question's text.");
  if (!shortText(answer, MAX_ANSWER)) throw new HttpError(400, `An answer needs some text (up to ${MAX_ANSWER} characters).`);
  return changeLocked(projectOrThrow(id), (data) => {
    const target = data.milestones[milestone]?.tasks?.[task]?.questions?.[question];
    if (!target) throw new HttpError(404, "There is no question at that position.");
    if (target.q !== q) throw new HttpError(409, "The list changed since you loaded it. Reload and try again.");
    target.a = answer.trim();
    delete target.by; // answered by the user
  });
}

function getDoc(id, wanted) {
  const notFound = new HttpError(404, "That document is not linked from this project's progress file.");
  const rel = String(wanted || "").split("#")[0].trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || rel.includes(":") || !DOC_TYPES.test(rel)) throw notFound;
  const project = projectOrThrow(id);
  // Read without full validation, like the PHP and Python servers: one bad entry must not hide every document.
  let data;
  try { data = parse(fs.readFileSync(project.progressPath, "utf8")); } catch { throw new HttpError(500, "The progress file is not valid JSON."); }
  if (!Array.isArray(data?.milestones) || !linkedDocs(data).has(rel)) throw notFound;
  const file = path.resolve(project.root, rel);
  try { assertInside(project.root, file); } catch { throw notFound; }
  let stat;
  try { stat = fs.statSync(file); } catch { throw new HttpError(404, `The linked document ${rel} does not exist.`); }
  if (!stat.isFile()) throw notFound;
  if (stat.size > MAX_DOC) throw new HttpError(413, "That document is larger than 2 MiB.");
  return { path: rel, text: fs.readFileSync(file, "utf8").replace(/^﻿/, "") };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!LOOPBACK.has(req.socket.remoteAddress)) throw new HttpError(403, "Only this computer may connect.");
    if (!allowedHosts.has(req.headers.host || "")) throw new HttpError(403, "Unknown host.");
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname;
    let m;

    if (req.method === "GET" && FILES[route]) {
      const [file, type] = FILES[route];
      return send(res, 200, fs.readFileSync(path.join(repo, "web", file)), type, type.startsWith("text/html") ? { "Content-Security-Policy": CSP } : {});
    }
    if (req.method === "GET" && route === "/api/health") return send(res, 200, { ok: true, runtime: "node", version: VERSION });
    if (req.method === "GET" && route === "/api/projects") {
      return send(res, 200, { projects: list().map((p) => ({ id: p.id, name: p.name, hasProgress: hasProgress(p) })) });
    }
    if (req.method === "GET" && (m = route.match(/^\/api\/projects\/([^/]+)\/progress$/))) {
      return send(res, 200, fs.readFileSync(projectOrThrow(decodeId(m[1])).progressPath, "utf8"));
    }
    if (req.method === "GET" && (m = route.match(/^\/api\/projects\/([^/]+)\/docs$/))) {
      return send(res, 200, getDoc(decodeId(m[1]), url.searchParams.get("path")));
    }
    if (req.method === "PATCH" && (m = route.match(/^\/api\/projects\/([^/]+)\/steps$/))) {
      return send(res, 200, await patchStep(req, decodeId(m[1])));
    }
    if (req.method === "PATCH" && (m = route.match(/^\/api\/projects\/([^/]+)\/questions$/))) {
      return send(res, 200, await patchQuestion(req, decodeId(m[1])));
    }
    throw new HttpError(404, "Not found.");
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Server error; see the server console." : err.message });
  }
});
server.requestTimeout = 15000;

server.listen(PORT, "127.0.0.1", () => {
  console.log(`doczi dashboard (Node.js ${process.versions.node}) → http://localhost:${PORT}/   Stop with Ctrl+C.`);
});

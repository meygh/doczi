// A lock around every change to a progress file, so two writers (an agent, the dashboard, the
// CLI) never overwrite each other's changes. The same protocol is used by the PHP and Python
// servers: an exclusive "<file>.lock" holding a random token, a short wait, and a stale limit.
import crypto from "node:crypto";
import fs from "node:fs";
import { env } from "./names.mjs";

export const STALE_MS = 30_000;
const waitMs = () => Number(env("LOCK_TIMEOUT_MS")) || 5_000;
const pause = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(pause, 0, 0, ms);

export class LockBusyError extends Error {
  constructor(file) { super(`Another change to ${file} is in progress; try again in a moment.`); }
}

// Run fn while holding the lock for file; returns what fn returns.
export function withLockSync(file, fn, { timeoutMs = waitMs() } = {}) {
  const lock = `${file}.lock`;
  const token = `${process.pid} ${crypto.randomBytes(8).toString("hex")}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // "wx" fails when anything (a file or a symlink) already sits at the lock path.
      fs.writeFileSync(lock, token, { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let age = 0;
      try { age = Date.now() - fs.lstatSync(lock).mtimeMs; } catch { continue; } // released meanwhile
      if (age > STALE_MS) { fs.rmSync(lock, { force: true }); continue; }
      if (Date.now() >= deadline) throw new LockBusyError(file);
      sleep(25);
    }
  }
  try {
    return fn();
  } finally {
    // Remove only our own lock: after a stale break it may belong to someone else.
    try { if (fs.readFileSync(lock, "utf8") === token) fs.rmSync(lock, { force: true }); } catch { /* already gone */ }
  }
}

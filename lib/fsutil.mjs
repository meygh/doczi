// Safe file writing shared by the store, the registry and "doczi init".
import crypto from "node:crypto";
import fs from "node:fs";

// Write text to file atomically: an exclusive, randomly named temp file, then rename. The
// rename replaces a symlink at the target instead of writing through it.
export function writeFileAtomic(file, text, mode = 0o644) {
  const tmp = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx", mode);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); } catch (err) { fs.rmSync(tmp, { force: true }); throw err; }
}

// True when path exists as anything, including a dangling symlink.
export function occupied(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

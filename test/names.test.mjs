import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

// The old name may appear only where it is kept on purpose: the rename's ADR and plan, the
// upgrade notes, tests of the fallback, and code lines that read it as a legacy name.
const ALLOWED = [/^docs\/adr\//, /^docs\/plans\/rename-doczi\.md$/, /^README\.md$/, /^docs\/API\.md$/, /^test\//, /^\.idea\//];
const OLD_NAME = /solo[-_ ]?keel|\bkeel/i;

test("the old name is left only where it is read as a legacy name", () => {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const leftovers = [];
  for (const file of r.stdout.split("\n").filter(Boolean)) {
    if (ALLOWED.some((re) => re.test(file)) || !fs.existsSync(path.join(repo, file))) continue;
    if (OLD_NAME.test(file)) leftovers.push(file);
    fs.readFileSync(path.join(repo, file), "utf8").split("\n").forEach((line, i) => {
      if (OLD_NAME.test(line) && !/legacy/i.test(line)) leftovers.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(leftovers, []);
});

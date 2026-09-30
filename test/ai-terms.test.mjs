import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText, isAllowed, addedLinesFromPatch, commitTextOf, stripAttribution } from "../lib/ai-terms.mjs";

test("scanText finds tool names, vendor names and attribution lines, with line numbers", () => {
  const hits = scanText("const a = 1;\n// written by Claude\nCo-Authored-By: someone <noreply@anthropic.com>\nclaudette is fine\n");
  assert.deepEqual(hits.map((h) => h.line), [2, 3]);
  assert.deepEqual(scanText("Generated with an assistant? no.\n"), []);
  assert.equal(scanText("🤖 Generated with something").length, 1);
  assert.equal(scanText("model gpt-4o here").length, 1);
});

test("scanText accepts extra terms from project config", () => {
  assert.equal(scanText("uses Acmebot internally", ["\\bacmebot\\b"]).length, 1);
});

test("isAllowed matches allowlist prefixes with either slash style", () => {
  const allow = ["CLAUDE.md", ".claude/", "docs/"];
  assert.equal(isAllowed("D:\\repo\\.claude\\hooks\\x.sh", "D:/repo", allow), true);
  assert.equal(isAllowed("/d/repo/docs/a.md", "/d/repo", allow), true);
  assert.equal(isAllowed("D:\\repo\\src\\a.go", "D:\\repo", allow), false);
  assert.equal(isAllowed("D:\\other\\CLAUDE.md", "D:\\repo", allow), false);
});

test("addedLinesFromPatch returns only added lines, per file", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: src/new.js",
    "+const x = 1; // by claude",
    "*** Update File: README.md",
    "@@",
    "-old claude line",
    "+new line",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(addedLinesFromPatch(patch), [
    { file: "src/new.js", text: "const x = 1; // by claude" },
    { file: "README.md", text: "new line" },
  ]);
});

test("commitTextOf returns the command text only for commit, tag and PR commands", () => {
  assert.equal(commitTextOf('git commit -m "feat: x"'), 'git commit -m "feat: x"');
  assert.equal(commitTextOf(["gh", "pr", "create", "--title", "x"]), "gh pr create --title x");
  assert.equal(commitTextOf("git -C ../repo tag -a v1 -m x") !== null, true);
  assert.equal(commitTextOf("grep claude README.md"), null);
});

test("stripAttribution removes trailers and footers and keeps the message", () => {
  const msg = "feat: add x\n\nBody.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n🤖 Generated with [Claude Code](https://x)\n\n";
  assert.equal(stripAttribution(msg), "feat: add x\n\nBody.\n");
});

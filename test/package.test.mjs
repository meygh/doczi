import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

// "npm install -g" only gets what npm packs; every file the CLI and servers open at run time
// must be in it.
test("the npm package contains everything the CLI, launchers and servers need", () => {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: repo, encoding: "utf8", shell: true });
  assert.equal(r.status, 0, r.stderr);
  const files = new Set(JSON.parse(r.stdout)[0].files.map((f) => f.path.replace(/\\/g, "/")));
  const needed = [
    "cli/doczi.mjs", "mcp/server.mjs", "hooks/hooks.json", "hooks/session-start.mjs",
    "serve", "serve.cmd", "serve.ps1",
    "server/node/server.mjs", "server/php/router.php", "server/python/server.py",
    "web/index.html", "web/app.js", "web/markdown.js", "web/export.js", "web/i18n.js", "web/i18n/en.js", "web/i18n/fa.js", "web/i18n/ar.js", "web/i18n/de.js", "web/i18n/es.js", "web/i18n/tr.js", "web/theme.js", "web/style.css",
    "templates/progress/milestones.example.json", "templates/progress/progress.schema.json",
    "templates/git-hooks/commit-msg", "templates/git-hooks/doczi-commit-msg.cjs",
    "rules/core.md", ".claude-plugin/plugin.json", ".mcp.json", "package.json",
  ];
  const missing = needed.filter((f) => !files.has(f));
  assert.deepEqual(missing, [], `missing from the npm package: ${missing.join(", ")}`);
  assert.equal([...files].some((f) => f.startsWith("test/")), false, "tests stay out of the package");
});

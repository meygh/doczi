#!/usr/bin/env node
// SessionStart: give the agent the enabled keel rules and a one-line progress status.
import fs from "node:fs";
import path from "node:path";
import { guarded, pluginRoot, project, readInput } from "./lib.mjs";
import { RULE_MODULES } from "../lib/config.mjs";
import { summarize } from "../lib/progress.mjs";
import { clean, DATA_LABEL } from "../lib/report.mjs";
import { openProject, readProgress } from "../lib/store.mjs";

guarded(() => {
  const input = readInput() || {};
  const { root, config, error } = project(input);
  const parts = [];

  if (error) {
    parts.push(`keel: ${error} keel rules are off for this session until it is fixed.`);
  } else {
    for (const name of config.rules.filter((r) => RULE_MODULES.includes(r))) {
      parts.push(fs.readFileSync(path.join(pluginRoot, "rules", `${name}.md`), "utf8").trim());
    }
    try {
      const s = summarize(readProgress(openProject(root)));
      const now = s.current ? `now on ${JSON.stringify(clean(s.current.id, 20) + " " + clean(s.current.name, 80))} (${s.current.percent}%)` : "all milestones complete";
      parts.push(`${DATA_LABEL} ${s.percent}% overall; ${now}; file ${JSON.stringify(clean(config.progress, 120))}. ` +
        `When calling keel MCP tools, pass project: ${JSON.stringify(root)}.`);
    } catch { /* no progress file: nothing to say */ }
  }

  if (!parts.length) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: parts.join("\n\n") },
  }));
});

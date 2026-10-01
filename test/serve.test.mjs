// The dashboard launchers: defaults on the first start, saved settings after --setup,
// --reset to forget them, flags for one run only, and a quick start. Each case runs against
// every launcher this machine can run (PowerShell on Windows, Bash where it is installed).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const has = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const hasPhp = has("php", ["-v"]);

const LAUNCHERS = [
  { name: "PowerShell", available: process.platform === "win32", run: (args, opts) => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repo, "serve.ps1"), ...args.map(psArg)], opts) },
  { name: "Bash", available: has("bash", ["-c", "exit 0"]), run: (args, opts) => spawnSync("bash", [path.join(repo, "serve"), ...args], opts) },
];
// Same mapping as the CLI's toPsArgs.
function psArg(a) {
  const names = { "--runtime": "-Runtime", "--port": "-Port", "--no-open": "-NoOpen", "--open": "-Open", "--setup": "-Setup", "--reset": "-Reset", "--dry-run": "-DryRun" };
  return names[a] || a;
}

const busyPort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => resolve(s));
});

for (const launcher of LAUNCHERS) {
  describe(`${launcher.name} launcher`, { skip: launcher.available ? false : `${launcher.name} is not available` }, () => {
    const setup = () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-serve-"));
      const env = { ...process.env, DOCZI_HOME: home };
      delete env.SOLO_KEEL_HOME;
      const run = (...args) => {
        const r = launcher.run(args, { env, encoding: "utf8", input: "", timeout: 30_000 });
        return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
      };
      return { home, run, conf: path.join(home, "serve.conf") };
    };

    test("the first start asks nothing and uses the defaults", () => {
      const { run, conf } = setup();
      const t = Date.now();
      const r = run("--dry-run");
      const ms = Date.now() - t;
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /Would serve with node on port \d+, opening the browser/);
      assert.match(r.out, /--setup/);
      assert.equal(fs.existsSync(conf), false, "defaults are not saved");
      assert.ok(ms < 3000, `took ${ms} ms`);
    });

    test("saved settings are used without questions, and flags change only this run", () => {
      const { run, conf } = setup();
      fs.writeFileSync(conf, `runtime=${hasPhp ? "php" : "node"}\nport=4911\nopen=no\n`);
      let r = run("--dry-run");
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, new RegExp(`Would serve with ${hasPhp ? "php" : "node"} on port 4911, without opening the browser`));
      r = run("--dry-run", "--port", "4912", "--open");
      assert.match(r.out, /on port 4912, opening the browser/);
      assert.match(fs.readFileSync(conf, "utf8"), /port=4911/);
    });

    test("--reset forgets the saved settings", () => {
      const { run, conf } = setup();
      fs.writeFileSync(conf, "runtime=node\nport=4913\nopen=no\n");
      const r = run("--reset", "--dry-run");
      assert.equal(r.status, 0, r.out);
      assert.equal(fs.existsSync(conf), false);
      assert.match(r.out, /Forgot the saved settings/);
      assert.match(r.out, /opening the browser/);
    });

    test("a saved port that is busy moves to the next free one, and an unknown runtime falls back", async () => {
      const { run, conf } = setup();
      const server = await busyPort();
      const busy = server.address().port;
      fs.writeFileSync(conf, `runtime=cobol\nport=${busy}\nopen=no\n`);
      const r = run("--dry-run");
      server.close();
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, new RegExp(`Port ${busy} is in use`));
      assert.doesNotMatch(r.out, new RegExp(`on port ${busy},`));
      assert.match(r.out, /Would serve with node/);
    });

    test("--setup asks, then saves the answers for next time", () => {
      const { home, conf } = setup();
      const env = { ...process.env, DOCZI_HOME: home };
      // Answers: runtime 1 (Node.js), port 4914, do not open the browser.
      const r = launcher.run(["--setup", "--dry-run"], { env, encoding: "utf8", input: "1\n4914\nn\n", timeout: 30_000 });
      const out = (r.stdout || "") + (r.stderr || "");
      assert.equal(r.status, 0, out);
      assert.match(fs.readFileSync(conf, "utf8"), /runtime=node[\s\S]*port=4914[\s\S]*open=no/);
      assert.match(out, /Saved/);
    });
  });
}

test("the CLI passes the new options on to the PowerShell launcher", () => {
  const cli = fs.readFileSync(path.join(repo, "cli/doczi.mjs"), "utf8");
  for (const [flag, ps] of [["setup", "-Setup"], ["reset", "-Reset"], ["dry-run", "-DryRun"]]) {
    assert.match(cli, new RegExp(`"?${flag}"?: "${ps}"`));
  }
});

// One HTTP contract (docs/API.md), three implementations. Each installed runtime runs the
// same checks; a missing runtime is skipped with a note, never silently passed.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "../lib/progress.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

const python = ["python3", "python"].find((c) => spawnSync(c, ["--version"], { encoding: "utf8" }).stdout?.startsWith("Python 3"));
const hasPhp = spawnSync("php", ["-v"], { encoding: "utf8" }).status === 0;

const RUNTIMES = [
  { name: "node", available: true, cmd: (port) => [process.execPath, [path.join(repo, "server/node/server.mjs"), "--port", String(port)]] },
  { name: "php", available: hasPhp, cmd: (port) => ["php", ["-S", `127.0.0.1:${port}`, path.join(repo, "server/php/router.php")]] },
  { name: "python", available: Boolean(python), cmd: (port) => [python, [path.join(repo, "server/python/server.py"), "--port", String(port)]] },
];

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

function request(port, method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port, method, path: url,
      headers: {
        Host: `127.0.0.1:${port}`,
        ...(data !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

function makeFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-http-"));
  const mk = (name, config, progress) => {
    const dir = path.join(home, name);
    fs.mkdirSync(path.join(dir, "docs", "progress"), { recursive: true });
    if (config) fs.writeFileSync(path.join(dir, ".doczi.json"), JSON.stringify(config));
    if (progress) fs.writeFileSync(path.join(dir, "docs/progress/milestones.json"), JSON.stringify(progress, null, 2));
    return dir;
  };
  const demo = mk("demo", null, {
    title: "Demo", updated: "2020-01-01",
    docs: [{ title: "Requirements", path: "docs/SRS.md#goals" }],
    milestones: [{
      id: "M0", name: "Start", weight: 2,
      docs: [{ path: "docs/plan.txt" }],
      tasks: [{
        name: "Setup",
        type: "feature",
        tags: ["ci", "پرداخت"],
        steps: [{ status: "todo", title: "Repo" }, { status: "doing", title: "CI" }],
        questions: [{ q: "Which CI?", a: "Jenkins", by: "agent" }],
        docs: [{ title: "Huge", path: "docs/big.md" }],
      }],
    }],
  });
  fs.writeFileSync(path.join(demo, "docs", "SRS.md"), "# Requirements\n\n## Goals\n\nShip it.\n");
  fs.writeFileSync(path.join(demo, "docs", "plan.txt"), "Plan text");
  fs.writeFileSync(path.join(demo, "docs", "secret.md"), "not listed");
  fs.writeFileSync(path.join(demo, "docs", "big.md"), "x".repeat(2 * 1024 * 1024 + 10));
  const empty = mk("empty");
  const evil = mk("evil", { progress: "../demo/docs/progress/milestones.json" });
  fs.writeFileSync(path.join(home, "projects.json"), JSON.stringify({
    projects: [
      { id: "demo", name: "Demo", path: demo },
      { id: "empty", name: "Empty", path: empty },
      { id: "evil", name: "Evil", path: evil },
    ],
  }));
  return { home, demoFile: path.join(demo, "docs/progress/milestones.json") };
}

async function startServer(rt, port, env) {
  const [cmd, args] = rt.cmd(port);
  const proc = spawn(cmd, args, { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  for (let i = 0; i < 100; i++) {
    try { if ((await request(port, "GET", "/api/health")).status === 200) return proc; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`${rt.name} server did not start: ${stderr}`);
}

for (const rt of RUNTIMES) {
  describe(`HTTP contract on ${rt.name}`, { skip: rt.available ? false : `${rt.name} is not installed` }, () => {
    let proc, port, fx;

    before(async () => {
      fx = makeFixture();
      port = await freePort();
      proc = await startServer(rt, port, { ...process.env, DOCZI_HOME: fx.home, DOCZI_PORT: String(port), DOCZI_LOCK_TIMEOUT_MS: "700" });
    });
    after(() => proc?.kill());

    test("health names the runtime", async () => {
      const r = await request(port, "GET", "/api/health");
      assert.deepEqual(r.json, { ok: true, runtime: rt.name, version: "0.1.0" });
      assert.equal(r.headers["cache-control"], "no-store");
      assert.equal(r.headers["x-content-type-options"], "nosniff");
    });

    test("projects lists ids, names and whether there is progress, but no paths", async () => {
      const r = await request(port, "GET", "/api/projects");
      assert.deepEqual(r.json.projects, [
        { id: "demo", name: "Demo", hasProgress: true },
        { id: "empty", name: "Empty", hasProgress: false },
        { id: "evil", name: "Evil", hasProgress: false },
      ]);
    });

    test("progress returns the stored file; unknown, empty and escaping projects are 404", async () => {
      const r = await request(port, "GET", "/api/projects/demo/progress");
      assert.equal(r.status, 200);
      assert.equal(r.json.title, "Demo");
      for (const id of ["nope", "empty", "evil"]) {
        const bad = await request(port, "GET", `/api/projects/${id}/progress`);
        assert.equal(bad.status, 404, id);
        assert.equal(typeof bad.json.error, "string");
      }
    });

    test("PATCH changes one step, writes one step per line and sets today's date", async () => {
      const r = await request(port, "PATCH", "/api/projects/demo/steps", { body: { milestone: 0, task: 0, step: 0, title: "Repo", status: "done" } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.milestones[0].tasks[0].steps[0].status, "done");
      const text = fs.readFileSync(fx.demoFile, "utf8");
      assert.match(text, /\n {12}\{ "status": "done", "title": "Repo" \},\n/);
      assert.equal(JSON.parse(text).updated, new Date().toISOString().slice(0, 10));
      assert.equal(JSON.parse(text).milestones[0].weight, 2);
    });

    test("a write keeps task types and tags, laid out exactly as every other writer does", async () => {
      const r = await request(port, "PATCH", "/api/projects/demo/steps", { body: { milestone: 0, task: 0, step: 1, title: "CI", status: "review" } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.milestones[0].tasks[0].type, "feature");
      assert.deepEqual(r.json.milestones[0].tasks[0].tags, ["ci", "پرداخت"]);
      const text = fs.readFileSync(fx.demoFile, "utf8");
      assert.equal(text, format(JSON.parse(text)));
    });

    test("PATCH refuses stale titles, bad statuses, bad positions and bad JSON", async () => {
      const at = (body) => request(port, "PATCH", "/api/projects/demo/steps", { body });
      assert.equal((await at({ milestone: 0, task: 0, step: 1, title: "Repo", status: "done" })).status, 409);
      assert.equal((await at({ milestone: 0, task: 0, step: 1, title: "CI", status: "finished" })).status, 400);
      assert.equal((await at({ milestone: 0, task: 0, step: 9, title: "CI", status: "done" })).status, 404);
      assert.equal((await at({ milestone: "0", task: 0, step: 1, title: "CI", status: "done" })).status, 400);
      assert.equal((await request(port, "PATCH", "/api/projects/demo/steps", { body: "{nope" })).status, 400);
      assert.equal((await request(port, "PATCH", "/api/projects/nope/steps", { body: { milestone: 0, task: 0, step: 0, title: "x", status: "done" } })).status, 404);
    });

    test("PATCH supports every status; blocked needs a reason, which leaves when unblocked", async () => {
      const at = (body) => request(port, "PATCH", "/api/projects/demo/steps", { body: { milestone: 0, task: 0, step: 1, title: "CI", ...body } });
      assert.equal((await at({ status: "blocked" })).status, 400);
      assert.equal((await at({ status: "blocked", reason: "   " })).status, 400);
      let r = await at({ status: "blocked", reason: "Waiting for runner" });
      assert.equal(r.status, 200, r.text);
      assert.match(fs.readFileSync(fx.demoFile, "utf8"), /\{ "status": "blocked", "title": "CI", "reason": "Waiting for runner" \}/);
      r = await at({ status: "review", reason: "ignored" });
      assert.equal(r.status, 200, r.text);
      assert.match(fs.readFileSync(fx.demoFile, "utf8"), /\{ "status": "review", "title": "CI" \}/);
      assert.equal((await at({ status: "blocked", reason: "x".repeat(2001) })).status, 400);
    });

    test("PATCH questions records an answer, refusing stale or empty ones", async () => {
      const at = (body) => request(port, "PATCH", "/api/projects/demo/questions", { body: { milestone: 0, task: 0, question: 0, q: "Which CI?", ...body } });
      assert.equal((await at({ answer: "" })).status, 400);
      assert.equal((await at({ q: "Other?", answer: "x" })).status, 409);
      assert.equal((await at({ question: 3, answer: "x" })).status, 404);
      const r = await at({ answer: "GitHub Actions" });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.milestones[0].tasks[0].questions[0].a, "GitHub Actions");
      assert.equal(r.json.milestones[0].tasks[0].questions[0].by, undefined, "an answer from the dashboard is the user's");
      assert.equal(JSON.parse(fs.readFileSync(fx.demoFile, "utf8")).milestones[0].tasks[0].questions[0].a, "GitHub Actions");
    });

    test("docs serves only documents the progress file links, inside the project", async () => {
      const doc = (p) => request(port, "GET", `/api/projects/demo/docs?path=${encodeURIComponent(p)}`);
      let r = await doc("docs/SRS.md");
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(r.json, { path: "docs/SRS.md", text: "# Requirements\n\n## Goals\n\nShip it.\n" });
      assert.equal((await doc("docs/SRS.md#goals")).status, 200);
      assert.equal((await doc("docs/plan.txt")).json.text, "Plan text");
      assert.equal((await doc("docs/big.md")).status, 413);
      for (const p of ["docs/secret.md", "../demo/docs/SRS.md", "docs/../docs/SRS.md", "C:/Windows/win.ini", "/etc/passwd", ".doczi.json", "", "docs/SRS.md:hidden.md", "docs/SRS.md::$DATA"]) {
        assert.equal((await doc(p)).status, 404, p);
      }
    });

    test("foreign Host headers, cross-site origins, non-JSON writes and huge bodies are refused", async () => {
      assert.equal((await request(port, "GET", "/api/projects", { headers: { Host: "evil.example" } })).status, 403);
      assert.equal((await request(port, "GET", "/", { headers: { Host: `evil.example:${port}` } })).status, 403);
      const body = { milestone: 0, task: 0, step: 1, title: "CI", status: "done" };
      assert.equal((await request(port, "PATCH", "/api/projects/demo/steps", { body, headers: { Origin: "http://evil.example" } })).status, 403);
      assert.equal((await request(port, "PATCH", "/api/projects/demo/steps", { body, headers: { Origin: `127.0.0.1:${port}` } })).status, 403);
      assert.equal((await request(port, "PATCH", "/api/projects/demo/steps", { body, headers: { Origin: "null" } })).status, 403);
      assert.equal((await request(port, "PATCH", "/api/projects/demo/steps", { body, headers: { Origin: `http://localhost:${port}` } })).status, 200);
      assert.equal((await request(port, "PATCH", "/api/projects/demo/steps", { body, headers: { "Content-Type": "text/plain" } })).status, 415);
      assert.equal((await request(port, "PATCH", "/api/projects/demo/steps", { body: JSON.stringify({ ...body, pad: "x".repeat(70000) }) })).status, 413);
    });

    test("writes wait for the progress lock, break a stale one, and answer 503 while it stays busy", async () => {
      const lock = fx.demoFile + ".lock";
      const body = { milestone: 0, task: 0, step: 1, title: "CI", status: "doing" };
      const patch = () => request(port, "PATCH", "/api/projects/demo/steps", { body });
      // Held, then released while the server waits.
      fs.writeFileSync(lock, "another writer");
      setTimeout(() => fs.rmSync(lock, { force: true }), 250);
      let r = await patch();
      assert.equal(r.status, 200, r.text);
      assert.equal(fs.existsSync(lock), false, "the server removes its own lock");
      // Held for longer than the server waits.
      fs.writeFileSync(lock, "another writer");
      r = await patch();
      assert.equal(r.status, 503, r.text);
      assert.equal(fs.readFileSync(lock, "utf8"), "another writer", "someone else's lock is left alone");
      // Stale (a crashed writer): broken.
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(lock, old, old);
      r = await patch();
      assert.equal(r.status, 200, r.text);
      assert.equal(fs.existsSync(lock), false);
    });

    test("serves only the dashboard files", async () => {
      const page = await request(port, "GET", "/");
      assert.equal(page.status, 200);
      assert.match(page.headers["content-type"], /text\/html/);
      assert.match(page.headers["content-security-policy"], /default-src 'self'/);
      assert.match((await request(port, "GET", "/app.js")).headers["content-type"], /javascript/);
      assert.match((await request(port, "GET", "/markdown.js")).headers["content-type"], /javascript/);
      assert.match((await request(port, "GET", "/export.js")).headers["content-type"], /javascript/);
      const bad = await request(port, "GET", "/api/projects/%E0%A4%A/progress");
      assert.ok([400, 404].includes(bad.status), `bad encoding gave ${bad.status}`);
      assert.match(bad.headers["content-type"], /application\/json/);
      for (const p of ["/package.json", "/../package.json", "/%2e%2e/package.json", "/server.mjs", "/router.php", "/api/nope"]) {
        assert.equal((await request(port, "GET", p)).status, 404, p);
      }
    });
  });
}

// Until v0.3 the servers still read the solo-keel registry home, SOLO_KEEL_HOME and a
// project's .solo-keel.json (docs/adr/0001-rename-to-doczi.md).
for (const rt of RUNTIMES) {
  for (const mode of ["default home", "SOLO_KEEL_HOME"]) {
    describe(`legacy names on ${rt.name} (${mode})`, { skip: rt.available ? false : `${rt.name} is not installed` }, () => {
      let proc, port;

      before(async () => {
        const user = fs.mkdtempSync(path.join(os.tmpdir(), "doczi-legacy-http-"));
        const project = path.join(user, "old");
        fs.mkdirSync(path.join(project, "plan"), { recursive: true });
        fs.writeFileSync(path.join(project, ".solo-keel.json"), JSON.stringify({ progress: "plan/p.json" }));
        fs.writeFileSync(path.join(project, "plan/p.json"), JSON.stringify({ milestones: [{ id: "M0", name: "Start", tasks: [{ name: "T", steps: [{ status: "done", title: "a" }] }] }] }));
        const registryHome = mode === "default home" ? path.join(user, ".solo-keel") : path.join(user, "custom");
        fs.mkdirSync(registryHome);
        const escaping = path.join(user, "escaping");
        fs.mkdirSync(escaping);
        fs.writeFileSync(path.join(escaping, ".solo-keel.json"), JSON.stringify({ progress: "../old/plan/p.json" }));
        fs.writeFileSync(path.join(registryHome, "projects.json"), JSON.stringify({ projects: [{ id: "old", name: "Old", path: project }, { id: "escaping", name: "Escaping", path: escaping }] }));
        const env = { ...process.env, HOME: user, USERPROFILE: user };
        delete env.DOCZI_HOME;
        delete env.SOLO_KEEL_HOME;
        if (mode === "SOLO_KEEL_HOME") env.SOLO_KEEL_HOME = registryHome;
        port = await freePort();
        proc = await startServer(rt, port, env);
      });
      after(() => proc?.kill());

      test("lists the project from the legacy registry and reads its legacy config", async () => {
        assert.deepEqual((await request(port, "GET", "/api/projects")).json.projects, [{ id: "old", name: "Old", hasProgress: true }, { id: "escaping", name: "Escaping", hasProgress: false }]);
        const r = await request(port, "GET", "/api/projects/old/progress");
        assert.equal(r.status, 200);
        assert.equal(r.json.milestones[0].id, "M0");
      });

      test("a legacy config cannot point the progress file outside its project", async () => {
        assert.equal((await request(port, "GET", "/api/projects/escaping/progress")).status, 404);
      });
    });
  }
}

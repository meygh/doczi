// keel dashboard: milestone → task → step checklists with progress computed from step statuses.
// Two modes:
//   API mode  — served by keel (Node.js, PHP or Python): pick a project; changes save to its file.
//   File mode — a standalone copy next to milestones.json; changes stay in this browser until
//               downloaded back into the file.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STATUSES = ["done", "review", "doing", "blocked", "todo"];
  const LABELS = { done: "Done", review: "Waiting for your check", doing: "In progress", blocked: "Blocked", todo: "Not started" };
  const WORTH = { done: 1, review: 0.75, doing: 0.5, blocked: 0, todo: 0 };
  const DOC_ICON = '<svg class="doc-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 1h5l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm4.5 1.5V6H12M5 8h6v1H5zm0 2.5h6v1H5z"/></svg>';
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const motion = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

  const storage = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  };

  // ---------------------------------------------------------------- toast (with optional undo)
  let toastTimer, toastUndo = null;
  function toast(message, { undo = null, alert = false } = {}) {
    const t = $("toast");
    $("toast-text").textContent = message;
    toastUndo = undo;
    $("toast-undo").hidden = !undo;
    t.classList.toggle("alert", alert);
    t.setAttribute("role", alert ? "alert" : "status");
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), alert ? 9000 : undo ? 6000 : 3500);
  }
  $("toast-undo").onclick = () => { const fn = toastUndo; toastUndo = null; $("toast").classList.remove("show"); fn?.(); };

  // ---------------------------------------------------------------- theme
  const themeLabel = { system: "◐ System", light: "☀ Light", dark: "☾ Dark" };
  let theme = document.documentElement.dataset.theme || "system";
  function applyTheme() {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $("theme").textContent = themeLabel[theme];
    $("theme").setAttribute("aria-label", `Theme: ${theme}. Change theme`);
    try { localStorage.setItem("progress-theme", theme); } catch { /* private mode */ }
  }
  $("theme").onclick = () => {
    const order = Object.keys(themeLabel);
    theme = order[(order.indexOf(theme) + 1) % order.length];
    applyTheme();
  };
  applyTheme();

  // Keep jump targets clear of the sticky header, whatever its height.
  if ("ResizeObserver" in window) {
    new ResizeObserver(([e]) => {
      const sticky = getComputedStyle(e.target).position === "sticky";
      document.documentElement.style.scrollPaddingTop = (sticky ? Math.ceil(e.contentRect.height) + 16 : 8) + "px";
    }).observe(document.querySelector(".topbar"));
  }

  // ---------------------------------------------------------------- data sources
  let mode = null;                   // "api" | "file"
  let projectId = null;              // API mode
  let dataFile = "milestones.json";  // file mode
  let data = null;
  let local = {};                    // file mode: step key → { status, reason }
  let ticksKey = "";
  let retry = null;                  // what "Try again" re-runs

  async function api(path, options = {}) {
    const res = await fetch(path, { cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw Object.assign(new Error(body?.error || `${res.status} ${res.statusText}`), { status: res.status });
    return body;
  }

  async function start() {
    try {
      const health = await api("api/health");
      if (health?.ok) return startApi();
    } catch { /* not served by keel */ }
    startFile();
  }

  async function startApi() {
    mode = "api";
    $("download").hidden = $("copy").hidden = $("discard").hidden = true;
    $("how-to-update").textContent = "Changes you make here save to the project's progress file straight away. Agents update the same file through keel's tools.";
    let projects;
    try { projects = (await api("api/projects")).projects; }
    catch (err) { retry = startApi; return fail("Couldn't reach the keel server", `${err.message}. Check that it is still running, then try again.`, false); }
    if (!projects.length) { retry = startApi; return fail("No projects yet", 'Run "keel init" inside a project to register it, then try again.', false); }
    const params = new URLSearchParams(location.search);
    const wanted = params.get("project") || storage.get("progress-project", null);
    const first = projects.find((p) => p.id === wanted && p.hasProgress) || projects.find((p) => p.hasProgress) || projects[0];
    $("project").innerHTML = projects.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === first.id ? "selected" : ""}>${esc(p.name)}${p.hasProgress ? "" : " (no progress file)"}</option>`).join("");
    $("project-picker").hidden = false;
    $("project").onchange = () => loadProject($("project").value, true);
    loadProject(first.id, true, true);
  }

  async function loadProject(id, fresh = false, fromUrl = false) {
    projectId = id;
    storage.set("progress-project", id);
    if (fresh) {
      view.page = null; openTasks.clear(); openMilestones.clear(); docCache.clear();
      if (!fromUrl) { filters.statuses.clear(); filters.query = ""; $("search").value = ""; }
    }
    if (!$("app").hidden) $("app").setAttribute("aria-busy", "true");
    try { show(await api(`api/projects/${encodeURIComponent(id)}/progress`)); }
    catch (err) {
      retry = () => loadProject(id);
      const name = $("project").selectedOptions[0]?.text || id;
      if (err.status === 404) fail(`${name} has no progress file yet`, 'Run "keel init" in the project to create one, then try again.', false);
      else fail(`Couldn't load ${name}`, `The keel server didn't answer (${err.message}). Check that it is still running, then try again.`, false);
    } finally { $("app").removeAttribute("aria-busy"); }
  }

  async function startFile() {
    mode = "file";
    const requested = new URLSearchParams(location.search).get("data") || "";
    dataFile = /^[\w.-]+\.json$/.test(requested) ? requested : "milestones.json";
    $("how-to-update").innerHTML = `To update, change a step's <code>status</code> in <code>${esc(dataFile)}</code>. Changes made here stay in
      this browser until you use "Download updated JSON".`;
    try {
      const res = await fetch(dataFile, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      show(await res.json());
    } catch (err) {
      retry = startFile;
      fail("The list couldn't be loaded", `Tried to read ${dataFile} (${err.message}).`);
    }
  }

  $("pick").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { show(JSON.parse(await file.text())); }
    catch (err) { fail("That file isn't valid JSON", `${file.name}: ${err.message}`); }
  };
  $("retry").onclick = () => { $("load-error").hidden = true; $("loading").hidden = false; retry?.(); };

  function fail(title, message, showFileHelp = mode === "file") {
    $("loading").hidden = true;
    $("load-error-title").textContent = title;
    $("load-error-text").textContent = message;
    $("file-help").hidden = !showFileHelp;
    $("retry").hidden = !retry;
    $("load-error").hidden = false;
    $("app").hidden = true;
    $("project-docs").hidden = true;
  }

  function check(json) {
    const problems = [];
    if (!json || !Array.isArray(json.milestones)) return ['The file has no "milestones" list.'];
    json.milestones.forEach((m, i) => {
      if (!m.id || !m.name) problems.push(`Milestone ${i + 1} needs an "id" and a "name".`);
      if (!Array.isArray(m.tasks)) m.tasks = [];
      m.tasks.forEach((t) => {
        if (!Array.isArray(t.steps)) t.steps = [];
        t.steps.forEach((s) => { if (!STATUSES.includes(s.status)) problems.push(`"${s.title}" has status "${s.status}".`); });
      });
    });
    return problems;
  }

  // ---------------------------------------------------------------- model
  const stepKey = (mi, ti, s) => `${data.milestones[mi].id}|${data.milestones[mi].tasks[ti].name}|${s.title}`;
  const statusOf = (s) => local[s.key]?.status || s.status;
  const reasonOf = (s) => (local[s.key] ? local[s.key].reason : s.reason);

  function derive(statuses, explicitBlock) {
    if (explicitBlock || statuses.includes("blocked")) return "blocked";
    if (!statuses.length || statuses.every((s) => s === "todo")) return "todo";
    if (statuses.every((s) => s === "done")) return "done";
    if (statuses.every((s) => s === "done" || s === "review")) return "review";
    return "doing";
  }
  const zeroShare = () => ({ done: 0, review: 0, doing: 0 });
  const zeroCounts = () => ({ total: 0, done: 0, review: 0, doing: 0, blocked: 0, todo: 0 });
  const pct = (sh) => Math.round((sh.done + sh.review + sh.doing) * 100);
  function weighted(items, weightOf) {
    const total = items.reduce((a, x) => a + weightOf(x), 0);
    const share = zeroShare();
    if (total) for (const x of items) for (const k in share) share[k] += (x.share[k] * weightOf(x)) / total;
    return share;
  }

  function summarize() {
    const counts = { steps: zeroCounts(), tasks: zeroCounts(), milestones: zeroCounts() };
    const milestones = data.milestones.map((m, mi) => {
      const tasks = m.tasks.map((t, ti) => {
        const statuses = t.steps.map(statusOf);
        const share = zeroShare();
        const n = { done: 0, review: 0, doing: 0 };
        statuses.forEach((s) => { counts.steps.total++; counts.steps[s]++; if (s in share) { share[s] += WORTH[s] / statuses.length; n[s]++; } });
        const status = derive(statuses, text(t.blocked));
        const reasons = [text(t.blocked), ...t.steps.filter((s) => statusOf(s) === "blocked").map((s) => `${s.title}: ${text(reasonOf(s)) || "no reason given"}`)].filter(Boolean);
        counts.tasks.total++; counts.tasks[status]++;
        const questions = Array.isArray(t.questions) ? t.questions : [];
        return { t, mi, ti, status, reasons, share, n, percent: pct(share), done: n.done, questions, open: questions.filter((q) => !text(q.a) || q.by === "agent").length };
      });
      const share = weighted(tasks, () => 1);
      const status = derive(tasks.map((x) => x.status), text(m.blocked));
      const reasons = [text(m.blocked), ...tasks.flatMap((x) => x.reasons.map((r) => `${x.t.name}: ${r}`))].filter(Boolean);
      counts.milestones.total++; counts.milestones[status]++;
      return { m, mi, tasks, status, reasons, share, percent: pct(share), weight: typeof m.weight === "number" ? m.weight : 1 };
    });
    const share = weighted(milestones, (x) => x.weight);
    return { milestones, share, percent: pct(share), counts, current: milestones.find((x) => x.status !== "done") || null };
  }

  // ---------------------------------------------------------------- docs
  const docCache = new Map();
  let linked = new Set();

  function docEntries(list) {
    if (!Array.isArray(list)) return [];
    return list.map((d) => (typeof d === "string" ? { path: d } : d)).filter((d) => d && text(d.path))
      .map((d) => ({ path: d.path.trim(), title: text(d.title) || docTitle(d.path) }));
  }
  function docTitle(p) {
    const words = p.split("#")[0].split("/").pop().replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]+/g, " ").trim();
    return words.length <= 5 ? words : words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
  }
  const chip = (d) => `<button type="button" class="chip" data-doc="${esc(d.path)}" data-title="${esc(d.title)}">${DOC_ICON}${esc(d.title)}</button>`;
  const chips = (list, label) => { const e = docEntries(list); return e.length ? `<div class="chips" role="group" aria-label="${esc(label)}">${e.map(chip).join("")}</div>` : ""; };

  function collectLinked() {
    linked = new Set();
    const lists = [data.docs, ...data.milestones.flatMap((m) => [m.docs, ...m.tasks.map((t) => t.docs)])];
    for (const l of lists) for (const d of docEntries(l)) linked.add(d.path.split("#")[0].replace(/^\.\//, ""));
  }

  async function fetchDoc(path) {
    if (docCache.has(path)) return docCache.get(path);
    let body;
    if (mode === "api") body = (await api(`api/projects/${encodeURIComponent(projectId)}/docs?path=${encodeURIComponent(path)}`)).text;
    else {
      const res = await fetch((typeof data.root === "string" ? data.root : "../../") + path, { cache: "no-store" });
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { status: res.status });
      body = await res.text();
    }
    docCache.set(path, body);
    return body;
  }

  let readerDir = "", readerOpener = null, lastDoc = null;
  async function openDoc(ref, title) {
    const [path, anchor = ""] = ref.split("#");
    const reader = $("reader"), body = $("reader-body");
    lastDoc = [ref, title];
    if (!reader.open) { readerOpener = document.activeElement; reader.showModal(); }
    $("reader-title").textContent = title || docTitle(path);
    $("reader-path").textContent = path;
    $("reader-toc").innerHTML = "";
    body.setAttribute("aria-busy", "true");
    body.innerHTML = '<p class="loading">Loading…</p>';
    try {
      const src = await fetchDoc(path);
      readerDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
      if (/\.txt$/i.test(path)) body.innerHTML = `<pre class="plain">${esc(src)}</pre>`;
      else {
        const out = window.keelMarkdown.render(src, { linked, dir: readerDir });
        body.innerHTML = out.html;
        const toc = out.toc.filter((h) => h.level === 2).slice(0, 30);
        $("reader-toc").innerHTML = toc.length > 1 ? toc.map((h) => `<a href="#" data-anchor="${esc(h.id)}">${esc(h.plain)}</a>`).join("") : "";
      }
      if (anchor) scrollToAnchor(anchor); else reader.scrollTop = 0;
    } catch (err) {
      body.innerHTML = err.status === 404
        ? `<p class="error">${esc(path)} wasn't found in the project. Check the path in the progress file.</p>`
        : `<p class="error">Couldn't open ${esc(path)} (${esc(err.message)}).</p><p><button type="button" class="primary" data-doc-retry>Try again</button></p>`;
    } finally { body.removeAttribute("aria-busy"); }
  }
  function scrollToAnchor(id) {
    const el = $("reader-body").querySelector(`[id="${CSS.escape(id)}"]`);
    if (el) { el.scrollIntoView({ block: "start" }); el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true }); }
  }
  $("reader-close").onclick = () => $("reader").close();
  $("reader").addEventListener("click", (e) => { if (e.target === $("reader")) $("reader").close(); });
  $("reader").addEventListener("close", () => { readerOpener?.focus?.(); readerOpener = null; });

  // ---------------------------------------------------------------- view state and URL
  const view = Object.assign({ perPage: 3, all: false }, storage.get("progress-view", {}), { page: null });
  if (![1, 2, 3, 5].includes(view.perPage)) view.perPage = 3;
  const initial = new URLSearchParams(location.search);
  const filters = {
    statuses: new Set((initial.get("status") || "").split(",").filter((s) => STATUSES.includes(s))),
    query: (initial.get("q") || "").trim().toLowerCase(),
  };
  $("search").value = initial.get("q") || "";
  const openMilestones = new Map(); // mi → bool
  const openTasks = new Map();      // "mi.ti" → bool
  const container = $("milestones");
  let summary = null;

  // Shareable address: project, filters and the item in view.
  function syncUrl(hash = location.hash) {
    const p = new URLSearchParams();
    if (mode === "api" && projectId) p.set("project", projectId);
    if (mode === "file" && dataFile !== "milestones.json") p.set("data", dataFile);
    if (filters.statuses.size) p.set("status", [...filters.statuses].join(","));
    if (filters.query) p.set("q", $("search").value.trim());
    const qs = p.toString();
    history.replaceState(null, "", `${location.pathname}${qs ? "?" + qs : ""}${hash || ""}`);
  }

  // ---------------------------------------------------------------- rendering
  function show(json) {
    const problems = check(json);
    if (problems.length) return fail("The progress file has problems", problems.slice(0, 5).join(" "));
    data = json;
    data.milestones.forEach((m, mi) => m.tasks.forEach((t, ti) => t.steps.forEach((s) => {
      Object.defineProperty(s, "key", { value: stepKey(mi, ti, s), enumerable: false, configurable: true });
    })));
    if (mode === "file") {
      ticksKey = "progress-ticks:" + dataFile;
      const saved = storage.get(ticksKey, {});
      local = {};
      const byKey = new Map(data.milestones.flatMap((m) => m.tasks.flatMap((t) => t.steps)).map((s) => [s.key, s]));
      for (const [k, v] of Object.entries(saved)) {
        const entry = typeof v === "string" ? { status: v } : v;
        const s = byKey.get(k);
        if (s && STATUSES.includes(entry?.status) && (entry.status !== s.status || (entry.reason || "") !== (s.reason || ""))) local[k] = entry;
      }
      storage.set(ticksKey, local);
    } else local = {};
    collectLinked();
    document.title = data.title || "Project progress";
    $("title").textContent = data.title || "Project progress";
    const when = data.updated ? new Date(data.updated + "T00:00:00") : null;
    $("updated").textContent = [
      when && !isNaN(when) ? "Updated " + when.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) + "." : "",
      text(data.subtitle),
    ].join(" ").trim();
    const projectDocs = docEntries(data.docs);
    $("project-docs").innerHTML = projectDocs.map(chip).join("");
    $("project-docs").hidden = !projectDocs.length;
    $("loading").hidden = true;
    $("load-error").hidden = true;
    $("app").hidden = false;
    const firstShow = summary === null;
    render();
    syncUrl();
    if (firstShow && location.hash) jumpTo(location.hash.slice(1), false);
  }

  const barHtml = (share, cls, name, n) => {
    const p = pct(share);
    const parts = n ? [n.done && `${n.done} done`, n.review && `${n.review} waiting for your check`, n.doing && `${n.doing} in progress`].filter(Boolean) : [];
    return `<div class="bar ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-label="${esc(name)} progress"` +
      ` aria-valuetext="${p}%${parts.length ? ": " + esc(parts.join(", ")) : ""}">` +
      ["done", "review", "doing"].map((k) => `<i class="${k}" data-w="${share[k] * 100}"></i>`).join("") + "</div>";
  };
  // Widths are applied after rendering: the page's CSP forbids inline style attributes.
  const paint = (root) => root.querySelectorAll("[data-w]").forEach((el) => { el.style.width = el.dataset.w + "%"; });

  const badge = (status) => `<span class="badge ${status}"><span class="dot ${status}" aria-hidden="true"></span>${esc(LABELS[status])}</span>`;
  let popSeq = 0;
  const info = (reasons, what) => {
    if (!reasons.length) return "";
    const id = `pop-${++popSeq}`;
    return `<span class="info"><button type="button" aria-label="Why is this ${what} blocked?" aria-expanded="false" aria-controls="${id}" aria-describedby="${id}">?</button>` +
      `<span class="pop" id="${id}"><strong>Blocked because</strong><ul>${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></span></span>`;
  };

  function matchesQuery(m, t) {
    const q = filters.query;
    if (!q) return { task: true, steps: new Set() };
    const has = (v) => String(v || "").toLowerCase().includes(q);
    const steps = new Set(t.steps.map((s, si) => (has(s.title) || has(reasonOf(s)) ? si : -1)).filter((x) => x >= 0));
    const task = has(t.name) || has(m.name) || has(m.id) || steps.size > 0 || (t.questions || []).some((x) => has(x.q) || has(x.a)) || has(t.note);
    return { task, steps };
  }

  // A stable description of what has focus, so a rebuild can put focus back.
  function focusMemo() {
    const a = document.activeElement;
    if (!a || a === document.body || !container.contains(a) && !$("legend").contains(a) && !$("pager").contains(a) && !$("attention").contains(a)) return null;
    for (const attr of ["data-step", "data-filter", "data-page", "data-menu", "data-toggle"]) {
      if (a.hasAttribute(attr)) return { sel: `[${attr}="${CSS.escape(a.getAttribute(attr))}"]`, task: a.closest(".task")?.id, ms: a.closest("section.ms")?.id };
    }
    return { sel: null, task: a.closest(".task")?.id, ms: a.closest("section.ms")?.id };
  }
  function restoreFocus(memo) {
    if (!memo) return;
    const target = (memo.sel && document.querySelector(memo.sel))
      || (memo.task && document.querySelector(`#${CSS.escape(memo.task)} [data-toggle]`))
      || (memo.ms && document.querySelector(`#${CSS.escape(memo.ms)} [data-toggle]`));
    target?.focus({ preventScroll: true });
  }

  function render() {
    const memo = focusMemo();
    popSeq = 0;
    summary = summarize();
    const s = summary;
    const c = s.counts;

    // Whole project
    $("total-pct").textContent = s.percent + "%";
    const total = document.createElement("div");
    total.innerHTML = barHtml(s.share, "thick", "Whole project", c.steps);
    total.firstChild.id = "total-bar";
    $("total-bar").replaceWith(total.firstChild);
    const openQs = s.milestones.reduce((a, x) => a + x.tasks.reduce((b, t) => b + t.open, 0), 0);
    $("total-stats").innerHTML = c.milestones.total
      ? `${c.steps.done} of ${c.steps.total} steps done · ${c.milestones.done} of ${c.milestones.total} milestones complete` +
        (s.current ? ` · now on <button class="link" data-jump="m-${s.current.mi}">${esc(s.current.m.id)} ${esc(s.current.m.name)}</button>` : "") +
        (openQs ? ` · <button class="link" data-jump="attention">${openQs} open question${openQs === 1 ? "" : "s"}</button>` : "")
      : "No milestones yet. Add one to the progress file, or ask your agent to plan the project.";

    // Tasks by status (the legend is the accessible version of the bar)
    $("status-bar").innerHTML = STATUSES.filter((k) => c.tasks[k]).map((k) => `<i class="${k}" data-w="${(c.tasks[k] / c.tasks.total) * 100}"></i>`).join("");
    $("legend").innerHTML = STATUSES.map((k) =>
      `<li><button type="button" data-filter="${k}" aria-pressed="${filters.statuses.has(k)}"><span class="dot ${k}" aria-hidden="true"></span>${esc(LABELS[k])} <span class="count">(${c.tasks[k]})</span></button></li>`).join("");
    $("clear-filter").hidden = !filters.statuses.size;

    renderAttention(s);

    // Milestones
    const filtering = filters.statuses.size > 0 || Boolean(filters.query);
    const hideDone = $("hide-done").checked;
    const pool = hideDone && !filtering ? s.milestones.filter((x) => x.status !== "done") : s.milestones;
    const pages = Math.max(1, Math.ceil(pool.length / view.perPage));
    if (view.page === null) view.page = Math.floor(Math.max(0, pool.indexOf(s.current)) / view.perPage);
    view.page = Math.min(Math.max(0, view.page), pages - 1);
    const shown = view.all || filtering ? pool : pool.slice(view.page * view.perPage, (view.page + 1) * view.perPage);
    renderPager(pool, pages, filtering);

    let visibleTasks = 0;
    const html = shown.map((ms) => {
      const m = ms.m;
      const tasks = ms.tasks.map((x) => {
        const q = matchesQuery(m, x.t);
        const hidden = !q.task || (filters.statuses.size && !filters.statuses.has(x.status));
        if (!hidden) visibleTasks++;
        return { x, q, hidden };
      });
      const anyVisible = !filtering || tasks.some((t) => !t.hidden);
      const open = filtering ? anyVisible : openMilestones.has(ms.mi) ? openMilestones.get(ms.mi) : ms === s.current;
      return `<section class="card ms ${ms.status === "done" ? "complete" : ""} ${anyVisible ? "" : "filtered-out"}" id="m-${ms.mi}" aria-labelledby="mt-${ms.mi}">
        <div class="ms-head">
          <div class="title-row">
            <h2 class="ms-title" id="mt-${ms.mi}"><button type="button" class="toggle" data-toggle="m-${ms.mi}" aria-expanded="${open}" aria-controls="mb-${ms.mi}"><span class="chev" aria-hidden="true">▸</span>${esc(m.id)} ${esc(m.name)}</button></h2>
            ${badge(ms.status)}${info(ms.reasons, "milestone")}
          </div>
          <span class="ms-meta">${ms.percent}%${m.when ? " · " + esc(m.when) : ""}</span>
        </div>
        ${barHtml(ms.share, "", `${m.id} ${m.name}`)}
        ${text(m.exit) ? `<p class="exit">Done when: ${esc(m.exit)}</p>` : ""}
        <div class="ms-body" id="mb-${ms.mi}" ${open ? "" : "hidden"}>
          ${chips(m.docs, `${m.id} documents`)}
          ${tasks.length ? tasks.map((t) => renderTask(ms, t.x, t.q, t.hidden)).join("") : '<p class="empty">No tasks yet.</p>'}
        </div>
      </section>`;
    }).join("");
    container.innerHTML = html || (hideDone && s.milestones.length
      ? '<p class="empty">Every milestone on this page is finished. Untick "Hide finished" to see them.</p>'
      : c.milestones.total ? "" : '<p class="empty">Nothing to show yet.</p>');
    paint(document);

    $("filter-note").hidden = !filtering;
    if (filtering) {
      const parts = [];
      if (filters.query) parts.push(`matching “${esc($("search").value.trim())}”`);
      if (filters.statuses.size) parts.push(`with status ${[...filters.statuses].map((k) => esc(LABELS[k])).join(" or ")}`);
      $("filter-note").innerHTML = `Showing ${visibleTasks} task${visibleTasks === 1 ? "" : "s"} ${parts.join(" and ")}. <button class="link" data-clear>Clear</button>`;
    }

    const changes = Object.keys(local).length;
    $("notice").classList.toggle("show", mode === "file" && changes > 0);
    $("notice-text").textContent = `You changed ${changes} step${changes === 1 ? "" : "s"} in this browser. ${dataFile} itself hasn't changed yet.`;
    restoreFocus(memo);
  }

  function renderTask(ms, x, q, hidden) {
    const t = x.t, key = `${ms.mi}.${x.ti}`;
    const defaultOpen = ["doing", "review", "blocked"].includes(x.status) || x.open > 0;
    const open = q.steps.size > 0 || (filters.query && q.task) || (openTasks.has(key) ? openTasks.get(key) : defaultOpen);
    const qBadge = x.questions.length
      ? `<span class="badge q ${x.open ? "open" : ""}"><span class="visually-hidden">Questions: </span><span aria-hidden="true">?</span> ${x.open ? `${x.open} open` : x.questions.length}</span>` : "";
    const steps = t.steps.map((st, si) => {
      const status = statusOf(st), reason = reasonOf(st), pos = `${ms.mi}.${x.ti}.${si}`;
      return `<li class="s-${status} ${q.steps.has(si) ? "match" : ""}">
        <input type="checkbox" data-step="${pos}" ${status === "done" ? "checked" : ""} aria-label="${esc(st.title)}">
        <span class="step-text"><span class="step-title">${esc(st.title)}</span>${status !== "done" && status !== "todo" ? badge(status) : ""}${status === "blocked" ? info([text(reason) || "No reason given"], "step") : ""}</span>
        <span class="step-menu">
          <button type="button" data-menu="${pos}" aria-expanded="false" aria-controls="menu-${pos}" aria-label="Status of ${esc(st.title)}: ${esc(LABELS[status])}. Change">⋯</button>
          <span class="menu" id="menu-${pos}" role="group" aria-label="Status"></span>
        </span>
      </li>`;
    }).join("");
    const qa = x.questions.length ? `<details class="qa-group" ${x.open ? "open" : ""}><summary><span class="chev" aria-hidden="true">▸</span>Questions and answers (${x.questions.length}${x.open ? `, ${x.open} open` : ""})</summary>
      ${x.questions.map((qq, qi) => {
        const answered = Boolean(text(qq.a)), byAgent = answered && qq.by === "agent", pending = !answered || byAgent;
        const form = (value, button) => `<form data-answer="${ms.mi}.${x.ti}.${qi}"><label class="visually-hidden" for="a-${key}-${qi}">Your answer</label>
              <textarea id="a-${key}-${qi}" name="answer" maxlength="4000" placeholder="Type your answer…" required>${esc(value)}</textarea>
              <div class="row"><button class="primary" type="submit">${button}</button></div></form>`;
        const body = !pending ? `<p class="answer">${esc(qq.a)}</p>`
          : byAgent ? `<p class="no-answer">Your agent recorded this answer. Confirm it, or change it first.</p>${mode === "api" ? form(qq.a, "Confirm answer") : `<p class="answer">${esc(qq.a)}</p>`}`
          : mode === "api" ? form("", "Save answer")
          : '<p class="no-answer">No answer yet. Answer it in the JSON file or ask your agent to record it.</p>';
        return `<details class="qa" ${pending ? "open" : ""}>
        <summary><span class="q-mark" aria-hidden="true">Q</span><span>${esc(qq.q)}</span>${!pending ? "" : byAgent ? '<span class="badge review">Confirm the agent\'s answer</span>' : '<span class="badge review">Needs your answer</span>'}</summary>
        <div class="qa-body">${body}</div>
      </details>`;
      }).join("")}</details>` : "";
    return `<div class="task ${x.status === "done" ? "complete" : ""} ${q.task && filters.query ? "match" : ""} ${hidden ? "filtered-out" : ""}" id="t-${key}">
      <div class="task-head">
        <div class="title-row">
          <h3 class="task-title"><button type="button" class="toggle" data-toggle="t-${key}" aria-expanded="${Boolean(open)}" aria-controls="tb-${key}"><span class="chev" aria-hidden="true">▸</span><span class="label">${esc(t.name)}</span></button></h3>
          ${badge(x.status)}${info(x.reasons, "task")}${qBadge}
        </div>
        <span class="task-meta">${x.done}/${t.steps.length} · ${x.percent}%</span>
      </div>
      ${barHtml(x.share, "thin", t.name, x.n)}
      <div class="task-body" id="tb-${key}" ${open ? "" : "hidden"}>
        ${chips(t.docs, `${t.name} documents`)}
        ${t.steps.length ? `<ul class="steps">${steps}</ul>` : '<p class="empty">No steps yet.</p>'}
        ${text(t.note) ? `<p class="note">${esc(t.note)}</p>` : ""}
        ${qa}
      </div>
    </div>`;
  }

  function renderAttention(s) {
    const blocked = [], review = [], questions = [];
    for (const ms of s.milestones) {
      if (text(ms.m.blocked)) blocked.push(`<li><a href="#m-${ms.mi}" data-jump="m-${ms.mi}">${esc(ms.m.id)} ${esc(ms.m.name)}</a> <span class="why">— ${esc(ms.m.blocked)}</span></li>`);
      for (const x of ms.tasks) {
        const key = `${ms.mi}.${x.ti}`;
        const where = `${esc(ms.m.id)} › ${esc(x.t.name)}`;
        if (x.status === "blocked") blocked.push(`<li><a href="#t-${key}" data-jump="t-${key}">${where}</a> <span class="why">— ${esc(x.reasons.join("; "))}</span></li>`);
        x.t.steps.forEach((st) => { if (statusOf(st) === "review") review.push(`<li><a href="#t-${key}" data-jump="t-${key}">${where} › ${esc(st.title)}</a></li>`); });
        x.questions.forEach((qq) => { if (!text(qq.a) || qq.by === "agent") questions.push(`<li><a href="#t-${key}" data-jump="t-${key}">${where}</a>: ${esc(qq.q)}${text(qq.a) ? " <span class=\"why\">(confirm the agent's answer)</span>" : ""}</li>`); });
      }
    }
    const group = (title, status, items) => items.length
      ? `<h3><span class="dot ${status}" aria-hidden="true"></span>${title} (${items.length})</h3><ul>${items.slice(0, 8).join("")}${items.length > 8
        ? `<li><button class="link" data-filter-only="${status}">Show all ${items.length}</button></li>` : ""}</ul>` : "";
    const html = group("Blocked", "blocked", blocked) + group("Waiting for your check", "review", review) + group("Questions for you", "review", questions);
    $("attention").hidden = !html;
    $("attention-body").innerHTML = html;
  }

  function renderPager(pool, pages, filtering) {
    $("show-all").textContent = view.all ? "Show in pages" : "Show all";
    $("show-all").setAttribute("aria-pressed", String(view.all));
    $("per-page").value = String(view.perPage);
    $("per-page").disabled = view.all || filtering;
    $("show-all").disabled = filtering;
    const pager = $("pager");
    if (view.all || filtering || pages === 1) { pager.innerHTML = ""; return; }
    const label = (i) => {
      const part = pool.slice(i * view.perPage, (i + 1) * view.perPage);
      return esc(part.length === 1 ? part[0].m.id : part[0].m.id + "–" + part[part.length - 1].m.id);
    };
    let html = `<button data-page="${view.page - 1}" ${view.page === 0 ? "disabled" : ""} aria-label="Previous page">‹ Previous</button>`;
    for (let i = 0; i < pages; i++) html += `<button data-page="${i}" ${i === view.page ? 'aria-current="page"' : ""}>${label(i)}</button>`;
    html += `<button data-page="${view.page + 1}" ${view.page === pages - 1 ? "disabled" : ""} aria-label="Next page">Next ›</button>`;
    html += `<span class="info-text">Page ${view.page + 1} of ${pages}</span>`;
    pager.innerHTML = html;
  }

  // Make a milestone or task visible (right page, expanded), scroll to it and focus it.
  function jumpTo(id, smooth = true) {
    if (id === "attention") return $("attention").scrollIntoView({ behavior: smooth ? motion() : "auto" });
    const m = id.match(/^([mt])-(\d+)(?:\.(\d+))?$/);
    if (!m || !summary) return;
    const mi = Number(m[2]);
    if (!summary.milestones[mi]) return;
    openMilestones.set(mi, true);
    if (m[3] !== undefined) openTasks.set(`${mi}.${m[3]}`, true);
    if (!document.getElementById(id) || document.getElementById(id).classList.contains("filtered-out")) {
      if (filters.statuses.size || filters.query) {
        filters.statuses.clear(); filters.query = ""; $("search").value = "";
        toast("Cleared the search and filters to show it.");
      }
      if ($("hide-done").checked && summary.milestones[mi].status === "done") { $("hide-done").checked = false; applyHide(); }
      if (!view.all) {
        const pool = $("hide-done").checked ? summary.milestones.filter((x) => x.status !== "done") : summary.milestones;
        view.page = Math.floor(Math.max(0, pool.findIndex((x) => x.mi === mi)) / view.perPage);
      }
    }
    render();
    syncUrl("#" + id);
    const el = $(id);
    if (el) { el.scrollIntoView({ behavior: smooth ? motion() : "auto", block: "start" }); el.querySelector("[data-toggle]")?.focus({ preventScroll: true }); }
  }
  window.addEventListener("hashchange", () => jumpTo(location.hash.slice(1)));

  function toggle(btn, force) {
    const id = btn.dataset.toggle;
    const body = $(btn.getAttribute("aria-controls"));
    const open = force ?? btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    if (body) body.hidden = !open;
    const m = id.match(/^([mt])-(\d+(?:\.\d+)?)$/);
    if (m[1] === "m") openMilestones.set(Number(m[2]), open); else openTasks.set(m[2], open);
  }

  // ---------------------------------------------------------------- changes
  const stepAt = (pos) => { const [mi, ti, si] = pos.split(".").map(Number); return { mi, ti, si, step: data.milestones[mi].tasks[ti].steps[si] }; };
  const previous = new Map(); // step key → { status, reason } before it was ticked done

  async function changeStatus(pos, status, reason, { undoable = true } = {}) {
    const { mi, ti, si, step } = stepAt(pos);
    const before = { status: statusOf(step), reason: reasonOf(step) };
    const undo = undoable && before.status !== status ? () => changeStatus(pos, before.status, before.reason, { undoable: false }) : null;
    if (status === "done" && before.status !== "done") previous.set(step.key, before);
    if (mode === "file") {
      if (status === step.status && (status !== "blocked" || (reason || "") === (step.reason || ""))) delete local[step.key];
      else local[step.key] = status === "blocked" ? { status, reason } : { status };
      storage.set(ticksKey, local);
      render();
      return toast(`${step.title}: ${LABELS[status]}`, { undo });
    }
    const li = container.querySelector(`[data-step="${pos}"]`)?.closest("li");
    li?.classList.add("saving");
    try {
      show(await api(`api/projects/${encodeURIComponent(projectId)}/steps`, {
        method: "PATCH",
        body: JSON.stringify({ milestone: mi, task: ti, step: si, title: step.title, status, ...(status === "blocked" ? { reason } : {}) }),
      }));
      toast(`${step.title}: ${LABELS[status]}`, { undo });
    } catch (err) {
      toast(err.status === 409 ? "The list changed meanwhile; showing the latest version." : `Not saved: ${err.message}`, { alert: err.status !== 409 });
      loadProject(projectId);
    }
  }

  async function saveAnswer(pos, answer) {
    const [mi, ti, qi] = pos.split(".").map(Number);
    const q = data.milestones[mi].tasks[ti].questions[qi];
    try {
      show(await api(`api/projects/${encodeURIComponent(projectId)}/questions`, {
        method: "PATCH",
        body: JSON.stringify({ milestone: mi, task: ti, question: qi, q: q.q, answer }),
      }));
      toast("Answer saved.");
      $(`t-${mi}.${ti}`)?.querySelector("[data-toggle]")?.focus({ preventScroll: true });
    } catch (err) {
      toast(err.status === 409 ? "The list changed meanwhile; showing the latest version." : `Not saved: ${err.message}`, { alert: err.status !== 409 });
      loadProject(projectId);
    }
  }

  // ---------------------------------------------------------------- menus and popovers
  function closeMenus({ except = null, restore = false } = {}) {
    for (const el of document.querySelectorAll(".step-menu.open, .info.open")) {
      if (el === except) continue;
      el.classList.remove("open");
      const trigger = el.querySelector(":scope > button");
      trigger.setAttribute("aria-expanded", "false");
      if (restore && el.contains(document.activeElement)) trigger.focus();
    }
  }

  function openMenu(btn) {
    const wrap = btn.closest(".step-menu");
    const willOpen = !wrap.classList.contains("open");
    closeMenus({ except: wrap });
    wrap.classList.toggle("open", willOpen);
    btn.setAttribute("aria-expanded", String(willOpen));
    if (!willOpen) return;
    const { step } = stepAt(btn.dataset.menu);
    const current = statusOf(step);
    wrap.querySelector(".menu").innerHTML = STATUSES.map((k) =>
      `<button type="button" class="opt" aria-pressed="${k === current}" data-set="${btn.dataset.menu}" data-status="${k}"><span class="dot ${k}" aria-hidden="true"></span>${esc(LABELS[k])}</button>`).join("");
    wrap.querySelector('.opt[aria-pressed="true"]')?.focus();
  }

  function askReason(opt) {
    const menu = opt.closest(".menu");
    const pos = opt.dataset.set;
    const { step } = stepAt(pos);
    menu.innerHTML = `<form data-reason="${pos}">
      <label for="r-${pos}">What is it waiting for?</label>
      <textarea id="r-${pos}" name="reason" maxlength="2000" required>${esc(text(reasonOf(step)))}</textarea>
      <div class="row"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">Mark blocked</button></div></form>`;
    menu.querySelector("textarea").focus();
  }

  // Close a menu when focus leaves it.
  document.addEventListener("focusout", (e) => {
    const wrap = e.target.closest?.(".step-menu.open, .info.open");
    if (wrap && e.relatedTarget && !wrap.contains(e.relatedTarget)) closeMenus();
  });

  // ---------------------------------------------------------------- events
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button, a");
    if (!el) { if (!e.target.closest(".step-menu, .info")) closeMenus(); return; }
    if (el.dataset.doc) { e.preventDefault(); return openDoc(el.dataset.doc, el.dataset.title); }
    if (el.hasAttribute("data-doc-retry")) { docCache.clear(); return lastDoc && openDoc(...lastDoc); }
    if (el.dataset.anchor !== undefined && el.closest("#reader")) { e.preventDefault(); return scrollToAnchor(el.dataset.anchor); }
    if (el.dataset.jump) { e.preventDefault(); return jumpTo(el.dataset.jump); }
    if (el.dataset.toggle) return toggle(el);
    if (el.dataset.filter || el.dataset.filterOnly) {
      const k = el.dataset.filter || el.dataset.filterOnly;
      if (el.dataset.filterOnly) { filters.statuses = new Set([k]); }
      else if (filters.statuses.has(k)) filters.statuses.delete(k); else filters.statuses.add(k);
      render(); syncUrl("");
      if (el.dataset.filterOnly) container.scrollIntoView({ behavior: motion(), block: "start" });
      return;
    }
    if (el.id === "clear-filter" || el.hasAttribute("data-clear")) {
      filters.statuses.clear(); filters.query = ""; $("search").value = "";
      render(); syncUrl("");
      return $("search").focus();
    }
    if (el.parentElement?.classList.contains("info")) {
      e.preventDefault();
      const wrap = el.parentElement, willOpen = !wrap.classList.contains("open");
      closeMenus({ except: wrap });
      wrap.classList.toggle("open", willOpen);
      el.setAttribute("aria-expanded", String(willOpen));
      return;
    }
    if (el.dataset.menu) { e.preventDefault(); return openMenu(el); }
    if (el.dataset.set) {
      e.preventDefault();
      if (el.dataset.status === "blocked") return askReason(el);
      closeMenus({ restore: true });
      return changeStatus(el.dataset.set, el.dataset.status);
    }
    if (el.hasAttribute("data-cancel")) { closeMenus({ restore: true }); return; }
    if (!el.closest(".step-menu, .info")) closeMenus();
  });

  document.addEventListener("submit", (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.dataset.reason) {
      const reason = form.reason.value.trim();
      if (!reason) return form.reason.focus();
      closeMenus({ restore: true });
      return changeStatus(form.dataset.reason, "blocked", reason);
    }
    if (form.dataset.answer) {
      const answer = form.answer.value.trim();
      if (!answer) return form.answer.focus();
      form.querySelector("button[type=submit]").disabled = true;
      return saveAnswer(form.dataset.answer, answer);
    }
  });

  container.addEventListener("change", (e) => {
    const box = e.target.closest("input[data-step]");
    if (!box) return;
    const { step } = stepAt(box.dataset.step);
    const current = statusOf(step);
    if (box.checked) return changeStatus(box.dataset.step, "done");
    // Unticking returns the step to where it was before it was ticked, when known.
    const before = previous.get(step.key);
    previous.delete(step.key);
    return before && before.status !== "done" ? changeStatus(box.dataset.step, before.status, before.reason) : changeStatus(box.dataset.step, current === "done" ? "todo" : current);
  });

  let searchTimer;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filters.query = $("search").value.trim().toLowerCase(); render(); syncUrl(""); }, 150);
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === "/" && !typing && !$("reader").open) { e.preventDefault(); $("search").focus(); return; }
    if (e.key === "Escape") {
      if (document.querySelector(".step-menu.open, .info.open")) { e.preventDefault(); closeMenus({ restore: true }); return; }
      if (document.activeElement === $("search") && $("search").value) { $("search").value = ""; filters.query = ""; render(); syncUrl(""); }
    }
  });

  // ---------------------------------------------------------------- paging, toolbar, export
  const saveView = () => storage.set("progress-view", { perPage: view.perPage, all: view.all });
  $("pager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-page]");
    if (!b || b.disabled) return;
    view.page = +b.dataset.page;
    render();
    container.scrollIntoView({ behavior: motion(), block: "start" });
  });
  $("per-page").onchange = () => {
    const firstShown = view.page * view.perPage;
    view.perPage = +$("per-page").value;
    view.page = Math.floor(firstShown / view.perPage);
    saveView(); render();
  };
  $("show-all").onclick = () => { view.all = !view.all; saveView(); render(); };
  $("expand").onclick = () => container.querySelectorAll("[data-toggle]").forEach((b) => toggle(b, true));
  $("collapse").onclick = () => container.querySelectorAll("[data-toggle]").forEach((b) => toggle(b, false));
  const hide = $("hide-done");
  hide.checked = storage.get("progress-hide-done", false) === true;
  function applyHide() { document.body.classList.toggle("hide-done", hide.checked); storage.set("progress-hide-done", hide.checked); }
  hide.onchange = () => { applyHide(); if (data) render(); };
  applyHide();

  // File mode: the file with this browser's changes applied, one step per line like keel writes it.
  function exportJson() {
    const out = JSON.parse(JSON.stringify(data));
    out.updated = new Date().toISOString().slice(0, 10);
    out.milestones.forEach((m, i) => m.tasks.forEach((t, j) => t.steps.forEach((s, n) => {
      const src = data.milestones[i].tasks[j].steps[n];
      s.status = statusOf(src);
      if (s.status === "blocked") s.reason = text(reasonOf(src)) || "No reason given"; else delete s.reason;
    })));
    return JSON.stringify(out, null, 2).replace(
      /\{\n\s+"status": ("[a-z]+"),\n\s+"title": ("(?:[^"\\]|\\.)*")(?:,\n\s+"reason": ("(?:[^"\\]|\\.)*"))?\n\s+\}/g,
      (_, st, ti, re) => `{ "status": ${st}, "title": ${ti}${re ? `, "reason": ${re}` : ""} }`) + "\n";
  }
  $("download").onclick = () => {
    const url = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: dataFile });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("copy").onclick = async () => {
    try { await navigator.clipboard.writeText(exportJson()); toast("Copied. Paste it over " + dataFile + "."); }
    catch { toast("Copying isn't allowed here; use Download instead.", { alert: true }); }
  };
  $("discard").onclick = () => {
    const n = Object.keys(local).length;
    if (!n || !confirm(`Discard ${n} change${n === 1 ? "" : "s"} made in this browser?`)) return;
    local = {}; storage.set(ticksKey, local); render();
  };

  start();
})();

// The progress file's own text in the reader's language. A project may keep translations next to
// its progress file (milestones.json → milestones.<lang>.json); the page shows the reader's
// language, else English, else the file as written. Statuses always come from the progress file
// itself: a translation lends only its text. Text no file covers can be machine translated by a
// provider the reader picks. Classic script, so the page also works from disk.
(function (global) {
  "use strict";

  const CODE = /^[a-z]{2,3}$/;
  const str = (v) => (typeof v === "string" && v.trim() ? v : null);

  // The languages to look for, best first, before falling back to the file as written.
  function order(wanted, base) {
    const out = [];
    for (const code of [wanted, "en"]) {
      if (code === base) break;
      if (CODE.test(code) && !out.includes(code)) out.push(code);
    }
    return out;
  }

  // translated text per object and field; the progress data itself is never changed, so saving
  // and downloading keep the original text.
  function lookup() {
    const map = new WeakMap();
    return {
      text(obj, key) { return map.get(obj)?.[key] ?? obj?.[key]; },
      has(obj, key) { return Boolean(map.get(obj)?.[key]); },
      set(obj, key, value) { if (!map.has(obj)) map.set(obj, {}); map.get(obj)[key] = value; },
    };
  }

  // Lend `tr`'s text to `base`, item by item. Milestones match by id; tasks, steps, questions and
  // documents by position, and only where the translation has as many as the file, so an
  // out-of-date translation never puts a title on the wrong step.
  function overlay(base, tr, into = lookup()) {
    if (!base || !tr || typeof tr !== "object") return into;
    const copy = (a, b, keys) => { for (const k of keys) if (str(a?.[k]) && str(b?.[k])) into.set(a, k, b[k]); };
    const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length;
    const docs = (a, b) => {
      if (!same(a, b)) return;
      a.forEach((d, i) => { if (d && typeof d === "object" && b[i]?.path === d.path) copy(d, b[i], ["title"]); });
    };
    copy(base, tr, ["title", "subtitle"]);
    docs(base.docs, tr.docs);
    const byId = new Map((Array.isArray(tr.milestones) ? tr.milestones : []).filter((m) => str(m?.id)).map((m) => [m.id.toLowerCase(), m]));
    for (const m of base.milestones || []) {
      const t = str(m?.id) && byId.get(m.id.toLowerCase());
      if (!t) continue;
      copy(m, t, ["name", "when", "exit", "blocked"]);
      docs(m.docs, t.docs);
      if (!same(m.tasks, t.tasks)) continue;
      m.tasks.forEach((task, i) => {
        const tt = t.tasks[i];
        copy(task, tt, ["name", "note", "blocked"]);
        docs(task.docs, tt?.docs);
        if (same(task.steps, tt?.steps)) task.steps.forEach((s, k) => copy(s, tt.steps[k], ["title", "reason"]));
        if (same(task.questions, tt?.questions)) task.questions.forEach((q, k) => copy(q, tt.questions[k], ["q", "a"]));
      });
    }
    return into;
  }

  // Every [object, field] of the file that holds text, for machine translation.
  function fields(base) {
    const out = [];
    const add = (o, keys) => { for (const k of keys) if (o && str(o[k])) out.push([o, k]); };
    const docs = (list) => (Array.isArray(list) ? list : []).forEach((d) => { if (d && typeof d === "object") add(d, ["title"]); });
    add(base, ["title", "subtitle"]);
    docs(base.docs);
    for (const m of base.milestones || []) {
      add(m, ["name", "when", "exit", "blocked"]);
      docs(m.docs);
      for (const t of m.tasks || []) {
        add(t, ["name", "note", "blocked"]);
        docs(t.docs);
        for (const s of t.steps || []) add(s, ["title", "reason"]);
        for (const q of t.questions || []) add(q, ["q", "a"]);
      }
    }
    return out;
  }

  // Machine translation providers the reader can pick. Each turns a list of texts into one or more
  // requests; the page's Content-Security-Policy names their hosts.
  const PROVIDERS = {
    mymemory: {
      name: "MyMemory",
      batch: 1, max: 500,
      request: ([q], from, to) => ({ url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${from}|${to}` }),
      read: (json) => [json?.responseStatus === 200 ? json.responseData?.translatedText : null],
    },
    google: {
      name: "Google Cloud Translation",
      batch: 100, max: 5000, needs: "key",
      request: (q, from, to, { key }) => ({
        url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
        body: { q, source: from, target: to, format: "text" },
      }),
      read: (json) => (json?.data?.translations || []).map((t) => t?.translatedText ?? null),
    },
    libre: {
      name: "LibreTranslate",
      batch: 50, max: 5000, needs: "url",
      request: (q, from, to, { url, key }) => ({
        url: String(url || "https://libretranslate.com").replace(/\/+$/, "") + "/translate",
        body: { q, source: from, target: to, format: "text", ...(key ? { api_key: key } : {}) },
      }),
      read: (json) => (Array.isArray(json?.translatedText) ? json.translatedText : [json?.translatedText]).map((t) => (typeof t === "string" ? t : null)),
    },
  };

  global.docziContent = { CODE, order, lookup, overlay, fields, PROVIDERS };
})(typeof window !== "undefined" ? window : globalThis);

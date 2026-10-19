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

  // A copy of the file with every text from `get(object, field)`, the way a translation file is
  // laid out; null while any text is missing, so a saved translation is never half done.
  function translated(base, get) {
    const copy = JSON.parse(JSON.stringify(base));
    const from = fields(base), to = fields(copy);
    for (let i = 0; i < from.length; i++) {
      const value = get(...from[i]);
      if (!str(value)) return null;
      to[i][0][to[i][1]] = value;
    }
    delete copy.language;
    return copy;
  }

  // docs/SRS.md → docs/SRS.fa.md, as the servers name translations.
  const translatedPath = (file, lang) => (/\.[^./\\]+$/.test(file) ? file.replace(/(\.[^./\\]+)$/, `.${lang}$1`) : `${file}.${lang}`);

  // A Markdown document as the texts to translate and a way to put it back together. Code, link
  // targets, table rules and list or heading marks are kept, so the translation renders the same.
  // A line goes out whole, its code and link targets as {0}, {1}…; a service that loses one of
  // those gets the line again in pieces between them (`fallback`).
  const INLINE = /(`+)[\s\S]*?\1|!\[[^\]]*\]\([^)]*\)|\]\([^)]*\)|\]\[[^\]]*\]|\[|<[^>\s]+>|https?:\/\/[^\s)]+|\{\d+\}/g;
  function markdownParts(src) {
    const pieces = [];
    const keep = (s) => { if (s) pieces.push(s); };
    const words = (s, into) => {
      const [, lead, body, tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
      if (lead) into.push(lead);
      if (/\p{L}/u.test(body)) into.push({ t: body }); else if (body) into.push(body);
      if (tail) into.push(tail);
    };
    const inline = (s) => {
      const [, lead, body, tail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
      if (!/\p{L}/u.test(body.replace(INLINE, ""))) { keep(s); return; }
      const tokens = [], frags = [];
      let at = 0, unit = "", m;
      INLINE.lastIndex = 0;
      while ((m = INLINE.exec(body))) {
        words(body.slice(at, m.index), frags); frags.push(m[0]);
        unit += body.slice(at, m.index) + `{${tokens.length}}`; tokens.push(m[0]);
        at = m.index + m[0].length;
      }
      words(body.slice(at), frags);
      keep(lead);
      pieces.push(tokens.length ? { t: unit + body.slice(at), tokens, frags } : { t: body });
      keep(tail);
    };
    // A paragraph or list item wrapped over several lines goes out as one sentence.
    const lines = [];
    let inFence = null, joinable = false;
    for (const line of String(src).replace(/\r\n?/g, "\n").split("\n")) {
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (inFence) { if (open && open[1][0] === inFence[0] && open[1].length >= inFence.length) inFence = null; lines.push(line); continue; }
      if (open) { inFence = open[1]; joinable = false; lines.push(line); continue; }
      const block = /^\s*($|#|\||>|[-*+]\s|\d+[.)]\s|<|\[[^\]]+\]:|([-*_])(\s*\2){2,}\s*$|=+\s*$|-+\s*$)/.test(line);
      if (joinable && !block) lines[lines.length - 1] = lines[lines.length - 1].trimEnd() + " " + line.trimStart();
      else lines.push(line);
      joinable = !/^\s*($|#|\||<|\[[^\]]+\]:|([-*_])(\s*\2){2,}\s*$|=+\s*$|-+\s*$)/.test(line) && !/( {2}|\\)$/.test(line);
    }
    let fence = null;
    lines.forEach((line, i) => {
      if (i) pieces.push("\n");
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) { keep(line); if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null; return; }
      if (open) { fence = open[1]; keep(line); return; }
      if (/^\s*$|^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$|^\s*([-*_])(\s*\2){2,}\s*$|^\s*\[[^\]]+\]:\s*\S|^\s*</.test(line)) { keep(line); return; }
      if (/^\s*\|/.test(line)) { line.split(/(\|)/).forEach((cell) => (cell === "|" ? keep(cell) : inline(cell))); return; }
      const mark = /^(\s*(?:(?:#{1,6}|>|[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)*)/.exec(line)[1];
      keep(mark);
      inline(line.slice(mark.length));
    });
    const units = pieces.filter((p) => typeof p !== "string");
    const one = (s) => (str(s) ? s.replace(/\s*\n\s*/g, " ") : null);
    // The translated line with its code and links back, or null when a placeholder was lost.
    const put = (p, out) => {
      if (!out) return null;
      if (!p.tokens) return out;
      const seen = out.match(/\{\d+\}/g) || [];
      if (seen.length !== p.tokens.length || p.tokens.some((_, i) => !seen.includes(`{${i}}`))) return null;
      return out.replace(/\{(\d+)\}/g, (_, i) => p.tokens[i]);
    };
    const frag = (f, get) => (typeof f === "string" ? f : one(get(f.t)) || f.t);
    return {
      texts: [...new Set(units.map((p) => p.t))],
      fallback: (get) => [...new Set(units.filter((p) => p.tokens && !put(p, one(get(p.t)))).flatMap((p) => p.frags.filter((f) => typeof f !== "string").map((f) => f.t)))],
      build: (get) => pieces.map((p) => (typeof p === "string" ? p : put(p, one(get(p.t))) ?? (p.tokens ? p.frags.map((f) => frag(f, get)).join("") : p.t))).join(""),
    };
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

  global.docziContent = { CODE, order, lookup, overlay, fields, translated, translatedPath, markdownParts, PROVIDERS };
})(typeof window !== "undefined" ? window : globalThis);

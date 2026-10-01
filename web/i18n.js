// Interface languages for the doczi dashboard. Strings live in i18n/<code>.js (English is the
// source and the fallback for anything missing); this file picks the language, loads its strings
// and formats text, numbers and dates for it. Classic script, so the page also works from disk.
(function (global) {
  "use strict";

  const LANGUAGES = [
    { code: "en", name: "English", dir: "ltr" },
    { code: "fa", name: "فارسی", dir: "rtl" },
    { code: "ar", name: "العربية", dir: "rtl" },
    { code: "de", name: "Deutsch", dir: "ltr" },
    { code: "es", name: "Español", dir: "ltr" },
    { code: "tr", name: "Türkçe", dir: "ltr" },
  ];
  const STORAGE_KEY = "doczi.lang";
  const strings = (global.docziStrings = global.docziStrings || {});
  const known = (code) => LANGUAGES.some((l) => l.code === code);

  // The saved choice, else the first browser language we have, else English.
  function choose() {
    try {
      const saved = global.localStorage?.getItem(STORAGE_KEY);
      if (known(saved)) return saved;
    } catch { /* storage blocked */ }
    for (const wanted of global.navigator?.languages || []) {
      const code = String(wanted).toLowerCase().split("-")[0];
      if (known(code)) return code;
    }
    return "en";
  }
  const lang = choose();
  const dir = LANGUAGES.find((l) => l.code === lang).dir;
  const doc = global.document;
  if (doc) { doc.documentElement.lang = lang; doc.documentElement.dir = dir; }

  const number = new Intl.NumberFormat(lang);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // The template for a key in this language (a plural set picks its form by `count`).
  function template(key, values) {
    const own = strings[lang]?.[key];
    let s = own !== undefined ? own : strings.en?.[key];
    if (s === undefined) return key;
    if (typeof s === "object") s = s[new Intl.PluralRules(lang).select(Number(values.count) || 0)] ?? s.other;
    return String(s);
  }
  const shown = (v) => (typeof v === "number" ? number.format(v) : String(v ?? ""));

  // Plain text: placeholders filled, `code` marks dropped.
  function t(key, values = {}) {
    return template(key, values).replace(/\{(\w+)\}/g, (m, k) => (k in values ? shown(values[k]) : m)).replace(/`([^`]*)`/g, "$1");
  }

  // HTML: the translation is escaped, `code` becomes <code>, and values are inserted as given
  // (callers pass HTML they built and escaped themselves; numbers are formatted).
  function html(key, values = {}) {
    const slots = [];
    const marked = template(key, values).replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in values)) return m;
      slots.push(typeof values[k] === "number" ? number.format(values[k]) : String(values[k]));
      return `\u0000${slots.length - 1}\u0000`;
    });
    return esc(marked).replace(/`([^`]*)`/g, "<code>$1</code>").replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
  }

  const percent = (p) => new Intl.NumberFormat(lang, { style: "percent" }).format(p / 100);
  const date = (d) => d.toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" });
  const list = (items, type = "conjunction") => (Intl.ListFormat ? new Intl.ListFormat(lang, { type }).format(items) : items.join(", "));

  // Fill elements marked in the page: data-i18n (text), data-i18n-html (with `code`) and
  // data-i18n-attr="aria-label:key,placeholder:key".
  function apply(root = doc) {
    if (!root) return;
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = html(el.dataset.i18nHtml); });
    root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      for (const pair of el.dataset.i18nAttr.split(",")) {
        const [attr, key] = pair.split(":");
        el.setAttribute(attr.trim(), t(key.trim()));
      }
    });
  }

  // Load this language's strings (English is always on the page). Resolves either way: a
  // missing file leaves English in place.
  const ready = lang === "en" || strings[lang] || !doc
    ? Promise.resolve()
    : new Promise((resolve) => {
      const s = doc.createElement("script");
      s.src = `i18n/${lang}.js`;
      s.onload = s.onerror = () => resolve();
      doc.head.appendChild(s);
    });

  function setLanguage(code) {
    if (!known(code)) return;
    try { global.localStorage?.setItem(STORAGE_KEY, code); } catch { /* storage blocked */ }
    global.location?.reload();
  }

  global.docziI18n = { LANGUAGES, lang, dir, t, html, apply, percent, date, list, num: (x) => number.format(x), ready, setLanguage };
})(typeof window !== "undefined" ? window : globalThis);

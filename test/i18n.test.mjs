// Interface languages: every language has every string, the same placeholders and valid plural
// forms; the page has no hard-coded text and no left/right-only layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => fs.readFileSync(path.join(repo, f), "utf8");
const CODES = ["en", "fa", "ar", "de", "es", "tr"];

// The page's i18n in a sandbox: i18n.js plus every language file, with a chosen language.
function load(lang = "en") {
  const ctx = { navigator: { languages: [lang] }, Intl };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const code of CODES) vm.runInContext(read(`web/i18n/${code}.js`), ctx);
  vm.runInContext(read("web/i18n.js"), ctx);
  return ctx;
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (v) => (typeof v === "string" ? [v] : Object.values(v));

test("the languages are English, Persian, Arabic, German, Spanish and Turkish; Persian and Arabic run right to left", () => {
  const { docziI18n } = load();
  assert.equal(docziI18n.LANGUAGES.map((l) => l.code).join(), CODES.join());
  assert.equal(docziI18n.LANGUAGES.filter((l) => l.dir === "rtl").map((l) => l.code).join(), "fa,ar");
});

test("every language has exactly the English keys, with the same placeholders", () => {
  const { docziStrings } = load();
  const en = docziStrings.en;
  for (const code of CODES.slice(1)) {
    const strings = docziStrings[code];
    assert.ok(strings, `${code} is loaded`);
    assert.deepEqual(Object.keys(strings).sort(), Object.keys(en).sort(), `${code} keys`);
    for (const [key, value] of Object.entries(strings)) {
      for (const form of forms(value)) {
        assert.ok(typeof form === "string" && form.trim(), `${code} ${key} is text`);
        assert.deepEqual(placeholders(form), placeholders(forms(en[key]).at(-1)), `${code} ${key} placeholders`);
      }
      if (typeof value === "object") assert.ok("other" in value, `${code} ${key} has an "other" form`);
    }
  }
});

test("t() fills placeholders, picks plural forms, formats numbers and falls back to English", () => {
  let { docziI18n } = load("en");
  assert.equal(docziI18n.t("filter.showing", { count: 1, parts: "x" }), "Showing 1 task x.");
  assert.equal(docziI18n.t("filter.showing", { count: 3, parts: "x" }), "Showing 3 tasks x.");
  assert.equal(docziI18n.t("no.such.key"), "no.such.key");
  ({ docziI18n } = load("fa"));
  assert.equal(docziI18n.lang, "fa");
  assert.match(docziI18n.t("pager.page", { page: 2, pages: 12 }), /۲.*۱۲/);
  assert.equal(docziI18n.percent(59), "۵۹٪");
});

test("html() escapes the translation, inserts values as given and turns `code` into <code>", () => {
  const { docziI18n, docziStrings } = load("en");
  docziStrings.en["test.html"] = "Use `doczi <serve>` for {file} & more";
  assert.equal(docziI18n.html("test.html", { file: "<b>x</b>" }), "Use <code>doczi &lt;serve&gt;</code> for <b>x</b> &amp; more");
  assert.equal(docziI18n.t("test.html", { file: "f" }), "Use doczi <serve> for f & more");
});

test("the browser's language is used when it is one of ours, English otherwise", () => {
  assert.equal(load("de-AT").docziI18n.lang, "de");
  assert.equal(load("ja").docziI18n.lang, "en");
});

test("the page has no text outside data-i18n, so every word can be translated", () => {
  const html = read("web/index.html");
  const allowed = new Set(["/", "✕", "▸", "1", "2", "3", "5", "0%"]);
  const offenders = [];
  for (const m of html.matchAll(/<([a-z0-9]+)([^>]*)>([^<]+)</gi)) {
    const textContent = m[3].trim();
    if (!textContent || allowed.has(textContent) || ["script", "style", "title", "code"].includes(m[1])) continue;
    if (!/data-i18n(-html)?=/.test(m[2])) offenders.push(`<${m[1]}> ${textContent.slice(0, 40)}`);
  }
  assert.deepEqual(offenders, []);
  for (const m of html.matchAll(/\s(aria-label|placeholder|title)="([^"]*)"/g)) {
    assert.fail(`${m[1]}="${m[2]}" should come from data-i18n-attr`);
  }
});

test("every key the page and the app use exists in English", () => {
  const en = load().docziStrings.en;
  const html = read("web/index.html"), app = read("web/app.js");
  const used = new Set([
    ...[...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((p) => p.split(":")[1])),
    ...[...app.matchAll(/\b(?:tr|trHtml)\("([\w.]+)"/g)].map((m) => m[1]),
  ]);
  assert.deepEqual([...used].filter((k) => !(k in en)), []);
});

test("the stylesheet lays out by start and end, not left and right", () => {
  const css = read("web/style.css");
  // Centred (left: 50%), stretched (left: 0; right: 0) and reset (auto) positions read the same
  // either way; anything else must say start or end.
  const physical = css.match(/[^-\w](margin|padding|border)-(left|right)\b|text-align:\s*(left|right)|[\s;{](left|right):(?!\s*(50%|0;|auto))/g);
  assert.deepEqual(physical, null);
  for (const m of css.matchAll(/(margin|padding):\s*([^\s;]+)\s+([^\s;]+)\s+([^\s;]+)\s+([^\s;]+)\s*;/g)) {
    assert.equal(m[3], m[5], `"${m[0]}" sets left and right differently`);
  }
});

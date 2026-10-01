// Static checks of the dashboard page: what can be pinned without a browser. Behaviour is
// checked by hand (see docs/plans/v0.2-dashboard.md, step 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const read = (f) => fs.readFileSync(fileURLToPath(new URL(`../web/${f}`, import.meta.url)), "utf8");
const html = read("index.html"), css = read("style.css"), app = read("app.js");

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

test("bar colours keep 3:1 against the track and the card in both themes", () => {
  const light = tokens(css.slice(0, css.indexOf("@media")));
  const dark = tokens(css.slice(css.indexOf('[data-theme="dark"]')));
  for (const [name, t] of [["light", light], ["dark", dark]]) {
    for (const k of ["done", "review", "doing"]) {
      for (const bg of ["track", "card"]) {
        assert.ok(contrast(t[k], t[bg]) >= 3, `${name} --${k} on --${bg}: ${contrast(t[k], t[bg]).toFixed(2)}`);
      }
    }
  }
});

test("task bars are at least 8px high and the page explains the bar colours", () => {
  const h = css.match(/\.bar\.task\s*\{[^}]*height:\s*(\d+)px/);
  assert.ok(h && Number(h[1]) >= 8, "a .bar.task rule with a height of 8px or more");
  assert.match(app, /barHtml\(x\.share, "task"/);
  assert.match(html, /id="bar-key"/);
});

test("the Needs you panel collapses, hides and remembers it per project", () => {
  assert.match(html, /id="attention-toggle"[^>]*aria-expanded="true"[^>]*aria-controls="attention-body"/);
  assert.match(html, /id="attention-show"[^>]*aria-pressed/);
  assert.match(app, /doczi\.attention\./);
  assert.match(app, /<details class="att-group" data-group="(\$\{[^}]+\}|blocked)"/);
});

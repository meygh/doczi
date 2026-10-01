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
  const h = css.match(/\.bar\.task-bar\s*\{[^}]*height:\s*(\d+)px/);
  assert.ok(h && Number(h[1]) >= 8, "a .bar.task-bar rule with a height of 8px or more");
  assert.match(app, /barHtml\(x\.share, "task-bar"/);
});

test("a bar's classes never pick up the layout rules of other components", () => {
  // A bar class that is also a component class (".task", ".ms", …) inherits its padding and
  // border, which squeezes the fill to nothing.
  const used = [...app.matchAll(/barHtml\([^,]+, "([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
  for (const cls of used) {
    const own = new RegExp(`(^|[\\s,}])\\.${cls.replace(/-/g, "\\-")}\\s*[{,]`, "m");
    assert.doesNotMatch(css, own, `.${cls} is styled on its own, outside .bar`);
  }
  assert.match(html, /id="bar-key"/);
});

test("the Needs you panel collapses, hides and remembers it per project", () => {
  assert.match(html, /id="attention-toggle"[^>]*aria-expanded="true"[^>]*aria-controls="attention-body"/);
  assert.match(html, /id="attention-show"[^>]*aria-pressed/);
  assert.match(app, /doczi\.attention\./);
  assert.match(app, /<details class="att-group" data-group="(\$\{[^}]+\}|blocked)"/);
});

test("the dashboard filters by task type and tag, and keeps them in the address", () => {
  assert.match(html, /id="type-legend"[^>]*data-i18n-attr="aria-label:filter\.byType"/);
  assert.match(html, /id="tag-legend"[^>]*data-i18n-attr="aria-label:filter\.byTag"/);
  assert.match(app, /data-filter-type=/);
  assert.match(app, /data-filter-tag=/);
  assert.match(app, /p\.set\("type"/);
  assert.match(app, /p\.set\("tags"/);
});

test("the dashboard downloads the plan as Markdown, CSV or JSON, with the shared exporter", () => {
  for (const id of ["export-md", "export-csv", "export-json"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('src="export.js"') > 0 && html.indexOf('src="export.js"') < html.indexOf('src="app.js"'), "export.js loads before app.js");
  assert.match(app, /docziExport\.markdown\(/);
  assert.match(app, /docziExport\.csv\(/);
});

test("milestone and task documents stay visible while their body is collapsed", () => {
  const before = (needle, body) => {
    const at = app.indexOf(needle), open = app.indexOf(body);
    assert.ok(at > 0 && open > 0, `${needle} and ${body} are both in the page`);
    assert.ok(at < open, `${needle} renders before ${body}, outside the collapsible part`);
  };
  before("chips(m.docs", 'class="ms-body"');
  before("chips(t.docs", 'class="task-body"');
});

test("each task shows a small bar in its heading, next to its step count", () => {
  const head = app.slice(app.indexOf('<div class="task-head">'), app.indexOf('class="task-body"'));
  const bar = head.indexOf('barHtml(x.share, "task-bar"'), meta = head.indexOf('class="task-meta"');
  assert.ok(bar > 0 && meta > 0, "the task bar and the step count are both in the heading");
  const group = head.indexOf('class="task-progress"');
  assert.ok(group > 0 && group < bar && bar < meta, "bar, then count, inside one inline group");
  const w = css.match(/\.bar\.task-bar\s*\{[^}]*width:\s*(\d+)px/);
  assert.ok(w && Number(w[1]) <= 120, "the task bar has a small fixed width");
});

test("each step shows a small bar filled by what its status is worth", () => {
  const step = app.slice(app.indexOf("const steps = t.steps.map("), app.indexOf("const qaTitle"));
  const bar = step.indexOf("stepBar(status)"), menu = step.indexOf('class="step-menu"');
  assert.ok(bar > step.indexOf('type="checkbox"') && bar < menu, "the bar sits in the step row, before its menu");
  assert.match(app, /const stepBar = \(status\) => `<span class="bar step-bar" aria-hidden="true">/);
  assert.match(app, /WORTH\[status\]/);
  assert.match(css, /\.bar\.step-bar\s*\{[^}]*width:\s*\d+px/);
});

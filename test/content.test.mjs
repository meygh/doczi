// The progress file's text in the reader's language (web/content.js): which file is used, what a
// translation may lend, and how each machine translation provider is asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(fileURLToPath(new URL("../web/content.js", import.meta.url)), "utf8"), ctx);
const { order, overlay, fields, PROVIDERS } = ctx.docziContent;

const persian = () => ({
  language: "fa",
  title: "پیشرفت",
  milestones: [
    { id: "M0", name: "پایه", tasks: [{ name: "مخزن", steps: [{ status: "done", title: "ساختار" }, { status: "todo", title: "CI" }], questions: [{ q: "کدام CI؟", a: "GitHub" }] }] },
    { id: "M1", name: "دمو", tasks: [{ name: "موتور", steps: [{ status: "doing", title: "IR" }] }] },
  ],
});

test("the reader's language comes first, then English, then the file as written", () => {
  assert.deepEqual([...order("de", "fa")], ["de", "en"]);
  assert.deepEqual([...order("en", "fa")], ["en"]);
  assert.deepEqual([...order("fa", "fa")], [], "a Persian reader reads the Persian file");
  assert.deepEqual([...order("de", "en")], ["de"], "an English file is its own English fallback");
});

test("a translation lends its text but never its statuses, and the file itself is unchanged", () => {
  const base = persian();
  const before = JSON.stringify(base);
  const english = {
    title: "Progress",
    milestones: [
      { id: "M1", name: "Demo", tasks: [{ name: "Engine", steps: [{ status: "done", title: "The IR" }] }] },
      { id: "m0", name: "Foundations", tasks: [{ name: "Repository", steps: [{ status: "todo", title: "Layout" }, { status: "todo", title: "CI" }], questions: [{ q: "Which CI?", a: "GitHub" }] }] },
    ],
  };
  const t = overlay(base, english);
  assert.equal(t.text(base, "title"), "Progress");
  assert.equal(t.text(base.milestones[0], "name"), "Foundations", "milestones match by id, in any order and case");
  assert.equal(t.text(base.milestones[0].tasks[0].steps[0], "title"), "Layout");
  assert.equal(t.text(base.milestones[0].tasks[0].questions[0], "q"), "Which CI?");
  assert.equal(t.text(base.milestones[1].tasks[0].steps[0], "title"), "The IR");
  assert.equal(base.milestones[1].tasks[0].steps[0].status, "doing");
  assert.equal(JSON.stringify(base), before, "saving and downloading keep the file's own text");
});

test("an out-of-date translation leaves the parts that no longer line up as written", () => {
  const base = persian();
  base.milestones[0].tasks[0].steps.push({ status: "todo", title: "انتشار" });
  base.milestones.push({ id: "M2", name: "تولید", tasks: [] });
  const t = overlay(base, {
    milestones: [{ id: "M0", name: "Foundations", tasks: [{ name: "Repository", steps: [{ status: "done", title: "Layout" }, { status: "todo", title: "CI" }] }] }],
  });
  assert.equal(t.text(base.milestones[0].tasks[0], "name"), "Repository");
  assert.equal(t.text(base.milestones[0].tasks[0].steps[0], "title"), "ساختار", "a step added since keeps every step as written");
  assert.equal(t.text(base.milestones[1], "name"), "دمو", "a milestone the translation lacks");
  assert.equal(t.text(base.milestones[2], "name"), "تولید");
  assert.equal(t.has(base.milestones[2], "name"), false);
});

test("machine translation sees every text of the file once", () => {
  const list = [...fields(persian()).map(([o, k]) => o[k])];
  assert.deepEqual(list, ["پیشرفت", "پایه", "مخزن", "ساختار", "CI", "کدام CI؟", "GitHub", "دمو", "موتور", "IR"]);
});

test("each provider is asked for plain text from the file's language to the reader's", () => {
  const my = PROVIDERS.mymemory.request(["سلام دنیا"], "fa", "en", {});
  assert.equal(my.url, "https://api.mymemory.translated.net/get?q=%D8%B3%D9%84%D8%A7%D9%85%20%D8%AF%D9%86%DB%8C%D8%A7&langpair=fa|en");
  assert.deepEqual([...PROVIDERS.mymemory.read({ responseStatus: 429, responseData: { translatedText: "QUOTA EXCEEDED" } })], [null], "a refused request is no translation");
  const g = PROVIDERS.google.request(["a", "b"], "fa", "de", { key: "k&1" });
  assert.equal(g.url, "https://translation.googleapis.com/language/translate/v2?key=k%261");
  assert.deepEqual({ ...g.body, q: [...g.body.q] }, { q: ["a", "b"], source: "fa", target: "de", format: "text" });
  assert.deepEqual([...PROVIDERS.google.read({ data: { translations: [{ translatedText: "A" }, { translatedText: "B" }] } })], ["A", "B"]);
  const l = PROVIDERS.libre.request(["a"], "fa", "en", { url: "http://localhost:5000/", key: "" });
  assert.equal(l.url, "http://localhost:5000/translate");
  assert.equal("api_key" in l.body, false);
  assert.deepEqual([...PROVIDERS.libre.read({ translatedText: ["A"] })], ["A"]);
});

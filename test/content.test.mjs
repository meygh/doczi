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
const { order, overlay, fields, translated, translatedPath, markdownParts, PROVIDERS } = ctx.docziContent;

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

test("a machine translation is kept only when every text is translated, laid out like the file", () => {
  const file = persian();
  const english = { "پیشرفت": "Progress", "پایه": "Foundation", "مخزن": "Repository", "ساختار": "Layout", "CI": "CI", "کدام CI؟": "Which CI?", "GitHub": "GitHub", "دمو": "Demo", "موتور": "Engine" };
  assert.equal(translated(file, (o, k) => english[o[k]]), null, "IR has no translation yet, so nothing is kept");
  english.IR = "IR";
  const copy = translated(file, (o, k) => english[o[k]]);
  assert.equal(copy.milestones[0].tasks[0].questions[0].q, "Which CI?");
  assert.equal(copy.milestones[1].tasks[0].steps[0].status, "doing", "statuses are copied as they are");
  assert.equal(copy.language, undefined, "the server names the translation's language");
  assert.equal(file.title, "پیشرفت", "the file itself is unchanged");
  assert.equal(translatedPath("docs/SRS.md", "fa"), "docs/SRS.fa.md");
  assert.equal(translatedPath("docs/v1.2/NOTES", "fa"), "docs/v1.2/NOTES.fa");
});

test("a document is translated line by line, with its code, links and tables kept", () => {
  const src = [
    "# Scope of work",
    "",
    "See [the plan](plan.md#goals) and run `make check`.",
    "",
    "| Name | Role |",
    "|---|:--:|",
    "| Ali | Lead `dev` |",
    "",
    "```go",
    "// Start the engine",
    "func main() {}",
    "```",
    "- [ ] Write the tests",
    "",
    "![diagram](flow.png)",
  ].join("\r\n");
  const parts = markdownParts(src);
  assert.deepEqual([...parts.texts], ["Scope of work", "See {0}the plan{1} and run {2}.", "Name", "Role", "Ali", "Lead {0}", "Write the tests"]);
  const fa = { "Scope of work": "دامنه‌ی کار", "See {0}the plan{1} and run {2}.": "{0}برنامه{1} را ببینید و {2} را اجرا کنید.", Name: "نام", Role: "نقش", Ali: "علی", "Lead {0}": "سرپرست {0}", "Write the tests": "تست‌ها را بنویسید" };
  assert.equal(parts.build((t) => fa[t]), [
    "# دامنه‌ی کار",
    "",
    "[برنامه](plan.md#goals) را ببینید و `make check` را اجرا کنید.",
    "",
    "| نام | نقش |",
    "|---|:--:|",
    "| علی | سرپرست `dev` |",
    "",
    "```go",
    "// Start the engine",
    "func main() {}",
    "```",
    "- [ ] تست‌ها را بنویسید",
    "",
    "![diagram](flow.png)",
  ].join("\n"));
});

test("a paragraph wrapped over several lines is translated as one sentence", () => {
  const parts = markdownParts("Requirement IDs are stable: plans and tests\nrefer to them.\n\n- An item that wraps\n  onto the next line\n- The next item\n\nPhases\n------");
  assert.deepEqual([...parts.texts], ["Requirement IDs are stable: plans and tests refer to them.", "An item that wraps onto the next line", "The next item", "Phases"]);
  assert.equal(parts.build((t) => t.toUpperCase()), "REQUIREMENT IDS ARE STABLE: PLANS AND TESTS REFER TO THEM.\n\n- AN ITEM THAT WRAPS ONTO THE NEXT LINE\n- THE NEXT ITEM\n\nPHASES\n------");
});

test("a service that drops a placeholder gets that line again in pieces, never a broken link", () => {
  const parts = markdownParts("See [the plan](plan.md) first.");
  const lost = { "See {0}the plan{1} first.": "Siehe den Plan zuerst." };
  assert.deepEqual([...parts.fallback((t) => lost[t])], ["See", "the plan", "first."]);
  const pieces = { ...lost, See: "Siehe", "the plan": "den Plan", "first.": "zuerst." };
  assert.equal(parts.build((t) => pieces[t]), "Siehe [den Plan](plan.md) zuerst.");
  assert.equal(parts.build(() => null), "See [the plan](plan.md) first.", "untranslated text stays as written");
});

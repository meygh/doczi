// Safe Markdown subset for the doczi dashboard: headings, paragraphs, lists (nested, task
// boxes), tables, code, quotes, rules, emphasis and links. Everything is escaped; generated
// HTML is never scanned again (links and code are built behind placeholders), and only
// http(s), mailto, in-page anchors and documents the progress file links become links.
(function (global) {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function render(src, { linked = new Set(), dir = "" } = {}) {
    const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    const toc = [];
    const used = new Map();
    const slug = (t) => {
      const base = t.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
      const n = used.get(base) || 0;
      used.set(base, n + 1);
      return n ? `${base}-${n}` : base;
    };

    function link(labelHtml, href) {
      if (/^(https?:|mailto:)/i.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
      if (href.startsWith("#")) return `<a href="#" data-anchor="${esc(href.slice(1))}">${labelHtml}</a>`;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return labelHtml; // other schemes are not followed
      const [p, anchor] = href.split("#");
      const parts = [];
      for (const seg of (dir + p).split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
      const target = parts.join("/");
      if (linked.has(target)) return `<a href="#" data-doc="${esc(target + (anchor ? "#" + anchor : ""))}">${labelHtml}</a>`;
      return `<span class="dead-link" title="${esc(href)} is not linked from the progress file">${labelHtml}</span>`;
    }

    // Emphasis on already-escaped text (no quotes or angle brackets can appear in it).
    const emphasis = (s) => s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");

    function inline(raw) {
      const slots = [];
      const hold = (html) => `\u{E000}${slots.push(html) - 1}\u{E001}`;
      let s = String(raw).replace(/[\u{E000}\u{E001}]/gu, "");
      s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
      s = s.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_, alt) => hold(`<span class="img-alt">[${esc(alt || "image")}]</span>`));
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => hold(link(emphasis(esc(label)), href)));
      s = s.replace(/<(https?:\/\/[^\s<>"']+)>/g, (_, u) => hold(link(esc(u), u)));
      s = emphasis(esc(s));
      for (let i = 0; i < 3 && /\u{E000}/u.test(s); i++) s = s.replace(/\u{E000}(\d+)\u{E001}/gu, (_, n) => slots[n] ?? "");
      return s;
    }

    const isItem = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
    const isRule = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;

    function list(start) {
      const base = indentOf(lines[start]);
      const ordered = /^\s*\d+[.)]/.test(lines[start]);
      const items = [];
      let i = start;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          if (i + 1 < lines.length && isItem(lines[i + 1]) && indentOf(lines[i + 1]) >= base) { i++; continue; }
          break;
        }
        const ind = indentOf(l);
        const m = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
        if (m && ind === base) { items.push({ text: m[1], sub: [] }); i++; continue; }
        if (ind > base && items.length) {
          if (isItem(l)) { const [html, next] = list(i); items[items.length - 1].sub.push(html); i = next; continue; }
          items[items.length - 1].text += " " + l.trim(); i++; continue;
        }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      const body = items.map((it) => {
        let t = it.text, box = "";
        const c = t.match(/^\[([ xX])\]\s+(.*)$/);
        if (c) { box = `<input type="checkbox" disabled ${c[1] === " " ? "" : "checked"}> `; t = c[2]; }
        return `<li>${box}${inline(t)}${it.sub.join("")}</li>`;
      }).join("");
      return [`<${tag}>${body}</${tag}>`, i];
    }

    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^\s*(```|~~~)\s*([\w+-]*)/))) {
        const fence = m[1], lang = m[2], buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++;
        html += `<pre>${lang ? `<span class="lang">${esc(lang)}</span>` : ""}<code>${esc(buf.join("\n"))}</code></pre>`;
        continue;
      }
      if (!line.trim()) { i++; continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        const level = m[1].length, plain = m[2].replace(/[*_`]/g, ""), id = slug(plain);
        toc.push({ level, id, plain });
        html += `<h${level} id="${esc(id)}">${inline(m[2])}</h${level}>`;
        i++; continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += "<hr>"; i++; continue; }
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*> ?/, ""));
        html += `<blockquote>${inline(buf.join(" "))}</blockquote>`;
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
        const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
        html += `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        continue;
      }
      if (isItem(line)) { const [out, next] = list(i); html += out; i = next; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>)/.test(lines[i]) && !isItem(lines[i])
        && !(lines[i].includes("|") && i + 1 < lines.length && isRule(lines[i + 1]))) buf.push(lines[i++].trim());
      html += `<p>${inline(buf.join(" "))}</p>`;
    }
    return { html, toc };
  }

  global.docziMarkdown = { render, esc };
})(typeof window !== "undefined" ? window : globalThis);

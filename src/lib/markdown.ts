function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeHref(value: string): string {
  const href = value.trim();
  return /^(https?:\/\/|mailto:|\/)/i.test(href) ? href : "#";
}

function inline(value: string): string {
  let text = esc(value);
  const code: string[] = [];
  text = text.replace(/\`([^\`]+)\`/g, (_, content: string) => {
    const token = "\u0000CODE" + code.length + "\u0000";
    code.push("<code>" + esc(content) + "</code>");
    return token;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    return '<a href="' + esc(safeHref(href)) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, index: string) => code[Number(index)] ?? "");
  return text;
}

export function renderMarkdown(source: string): string {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  let code: { language: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push("<" + list.type + ">" + list.items.map((item) => "<li>" + inline(item) + "</li>").join("") + "</" + list.type + ">");
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push("<blockquote>" + quote.map((item) => "<p>" + inline(item) + "</p>").join("") + "</blockquote>");
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const fence = line.match(/^\`\`\`\s*([\w-]*)\s*$/);
    if (code) {
      if (fence) {
        out.push('<pre><code class="language-' + esc(code.language) + '">' + esc(code.lines.join("\n")) + "</code></pre>");
        code = null;
      } else {
        code.lines.push(raw);
      }
      continue;
    }
    if (fence) {
      flushAll();
      code = { language: fence[1] ?? "", lines: [] };
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
      continue;
    }
    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      flushAll();
      out.push("<hr>");
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (list?.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (list?.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (code) out.push("<pre><code>" + esc(code.lines.join("\n")) + "</code></pre>");
  flushAll();
  return out.join("");
}

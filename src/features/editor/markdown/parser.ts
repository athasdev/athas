import DOMPurify from "dompurify";
import { normalizeCodeFenceLanguage } from "./language-map";

interface Footnote {
  id: string;
  text: string;
}

interface FrontMatterEntry {
  key: string;
  value: string;
}

export interface ParseMarkdownOptions {
  frontMatter?: "preserve" | "render" | "strip";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function applyInlineFormatting(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

function processInline(text: string, footnotes: Footnote[]): string {
  const protectedSegments: string[] = [];
  const protect = (html: string): string => {
    const token = `\u0000ATHAS${protectedSegments.length}\u0000`;
    protectedSegments.push(html);
    return token;
  };

  let processed = text
    .replace(/`([^`]+)`/g, (_, code) => protect(`<code>${code}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, source) =>
      protect(`<img src="${source}" alt="${alt}" />`),
    )
    .replace(/\[\^([^\]]+)\]/g, (match, id) => {
      const footnoteIndex = footnotes.findIndex((fn) => fn.id === id);
      if (footnoteIndex !== -1) {
        return protect(
          `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}">${footnoteIndex + 1}</a></sup>`,
        );
      }
      return match;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, destination) =>
      protect(
        `<a href="${destination}" target="_blank" rel="noopener noreferrer">${applyInlineFormatting(label)}</a>`,
      ),
    );

  processed = applyInlineFormatting(processed);

  for (let index = protectedSegments.length - 1; index >= 0; index--) {
    processed = processed.split(`\u0000ATHAS${index}\u0000`).join(protectedSegments[index]);
  }

  return processed;
}

function processTable(lines: string[], footnotes: Footnote[]): string {
  if (lines.length < 2) return lines.join("\n");

  const tableHtml: string[] = ["<table>"];

  const headerCells = lines[0]
    .split("|")
    .filter((cell) => cell.trim() !== "")
    .map((cell) => `<th>${processInline(cell.trim(), footnotes)}</th>`);
  tableHtml.push(`<thead><tr>${headerCells.join("")}</tr></thead>`);

  if (lines.length > 2) {
    tableHtml.push("<tbody>");
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i]
        .split("|")
        .filter((cell) => cell.trim() !== "")
        .map((cell) => `<td>${processInline(cell.trim(), footnotes)}</td>`);
      tableHtml.push(`<tr>${cells.join("")}</tr>`);
    }
    tableHtml.push("</tbody>");
  }

  tableHtml.push("</table>");
  return tableHtml.join("");
}

function extractYamlFrontMatter(content: string): { frontMatter: string[]; body: string } {
  const lines = content.split("\n");
  const firstLine = lines[0]?.replace(/^\uFEFF/, "").trim();

  if (firstLine !== "---") {
    return { frontMatter: [], body: content };
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---" || line === "...") {
      return { frontMatter: lines.slice(1, i), body: lines.slice(i + 1).join("\n") };
    }
  }

  return { frontMatter: [], body: content };
}

function parseFrontMatterEntries(frontMatter: string[]): FrontMatterEntry[] {
  const entries: FrontMatterEntry[] = [];
  const stack: Array<{ indent: number; key: string }> = [];

  for (const rawLine of frontMatter) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const match = rawLine.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const key = match[2].trim();
    const value = match[3].trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const propertyPath = [...stack.map((item) => item.key), key].join(".");
    entries.push({ key: propertyPath, value });

    if (!value) {
      stack.push({ indent, key });
    }
  }

  return entries;
}

function renderFrontMatter(frontMatter: string[]): string | null {
  const entries = parseFrontMatterEntries(frontMatter);
  if (entries.length === 0) return null;

  const title = entries.find((entry) => entry.key === "title" && entry.value)?.value;
  const description = entries.find((entry) => entry.key === "description" && entry.value)?.value;
  const propertyEntries = entries.filter(
    (entry) => entry.value && entry.key !== "title" && entry.key !== "description",
  );

  const headerParts = [
    title ? `<div class="markdown-front-matter-heading">${escapeHtml(title)}</div>` : "",
    description
      ? `<p class="markdown-front-matter-description">${escapeHtml(description)}</p>`
      : "",
  ].join("");

  const rows = propertyEntries
    .map(
      (entry) =>
        `<div class="markdown-front-matter-item"><dt>${escapeHtml(entry.key)}</dt><dd>${escapeHtml(entry.value)}</dd></div>`,
    )
    .join("");

  const propertyGrid = rows ? `<dl class="markdown-front-matter-grid">${rows}</dl>` : "";
  return `<section class="markdown-front-matter" aria-label="Document properties">${headerParts}${propertyGrid}</section>`;
}

export function parseMarkdown(content: string, options: ParseMarkdownOptions = {}): string {
  const frontMatterMode = options.frontMatter ?? "preserve";
  const { frontMatter, body } =
    frontMatterMode === "preserve"
      ? { frontMatter: [], body: content }
      : extractYamlFrontMatter(content);
  const lines = body.split("\n");
  const processedLines: string[] = [];
  const footnotes: Footnote[] = [];
  let inUnorderedList = false;
  let inOrderedList = false;
  let inTaskList = false;
  let inCodeBlock = false;
  let inBlockquote = false;
  let codeBlockContent = "";
  let codeBlockLanguage = "";
  const isTaskListLine = (value: string) => /^\s*[-*+]\s\[([ xX])\]\s/.test(value);
  const isUnorderedListLine = (value: string) => /^\s*[-*+]\s/.test(value);
  const isOrderedListLine = (value: string) => /^\s*\d+\.\s/.test(value);
  const isBlockquoteLine = (value: string) => /^>\s/.test(value);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (line.match(/^```/)) {
      if (inCodeBlock) {
        const lang = normalizeCodeFenceLanguage(codeBlockLanguage || "plaintext");
        const escaped = escapeHtml(codeBlockContent.trim());
        processedLines.push(`<pre><code class="language-${lang}">${escaped}</code></pre>`);
        codeBlockContent = "";
        codeBlockLanguage = "";
        inCodeBlock = false;
      } else {
        codeBlockLanguage = line.replace(/^```/, "").trim();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += `${line}\n`;
      continue;
    }

    if (inUnorderedList && trimmedLine !== "" && !isUnorderedListLine(line)) {
      processedLines.push("</ul>");
      inUnorderedList = false;
    }
    if (inTaskList && trimmedLine !== "" && !isTaskListLine(line)) {
      processedLines.push("</ul>");
      inTaskList = false;
    }
    if (inOrderedList && trimmedLine !== "" && !isOrderedListLine(line)) {
      processedLines.push("</ol>");
      inOrderedList = false;
    }
    if (inBlockquote && trimmedLine !== "" && !isBlockquoteLine(line)) {
      processedLines.push("</blockquote>");
      inBlockquote = false;
    }

    // Preserve raw HTML blocks (e.g., <details>, <summary>, <table>) as-is
    if (trimmedLine.startsWith("<") && trimmedLine.endsWith(">")) {
      processedLines.push(trimmedLine);
      continue;
    }

    if (line.match(/^######\s/)) {
      processedLines.push(`<h6>${processInline(line.replace(/^######\s/, ""), footnotes)}</h6>`);
    } else if (line.match(/^#####\s/)) {
      processedLines.push(`<h5>${processInline(line.replace(/^#####\s/, ""), footnotes)}</h5>`);
    } else if (line.match(/^####\s/)) {
      processedLines.push(`<h4>${processInline(line.replace(/^####\s/, ""), footnotes)}</h4>`);
    } else if (line.match(/^###\s/)) {
      processedLines.push(`<h3>${processInline(line.replace(/^###\s/, ""), footnotes)}</h3>`);
    } else if (line.match(/^##\s/)) {
      processedLines.push(`<h2>${processInline(line.replace(/^##\s/, ""), footnotes)}</h2>`);
    } else if (line.match(/^#\s/)) {
      processedLines.push(`<h1>${processInline(line.replace(/^#\s/, ""), footnotes)}</h1>`);
    } else if (line.match(/^(---+|___+|\*\*\*+)$/)) {
      processedLines.push("<hr />");
    } else if (isBlockquoteLine(line)) {
      if (!inBlockquote) {
        processedLines.push("<blockquote>");
        inBlockquote = true;
      }
      processedLines.push(`<p>${processInline(line.replace(/^>\s/, ""), footnotes)}</p>`);
    } else if (isTaskListLine(line)) {
      if (!inTaskList) {
        processedLines.push('<ul class="task-list">');
        inTaskList = true;
      }
      const match = line.match(/^\s*[-*+]\s\[([ xX])\]\s(.*)$/);
      if (match) {
        const checked = match[1].toLowerCase() === "x";
        const taskContent = match[2];
        processedLines.push(
          `<li class="task-list-item"><input type="checkbox" ${checked ? "checked" : ""} disabled /> ${processInline(taskContent, footnotes)}</li>`,
        );
      }
    } else if (isUnorderedListLine(line)) {
      if (!inUnorderedList) {
        processedLines.push("<ul>");
        inUnorderedList = true;
      }
      processedLines.push(`<li>${processInline(line.replace(/^\s*[-*+]\s/, ""), footnotes)}</li>`);
    } else if (isOrderedListLine(line)) {
      if (!inOrderedList) {
        processedLines.push("<ol>");
        inOrderedList = true;
      }
      processedLines.push(`<li>${processInline(line.replace(/^\s*\d+\.\s/, ""), footnotes)}</li>`);
    } else if (line.match(/^\[\^([^\]]+)\]:\s(.+)$/)) {
      const match = line.match(/^\[\^([^\]]+)\]:\s(.+)$/);
      if (match) {
        footnotes.push({ id: match[1], text: match[2] });
      }
    } else if (line.match(/^\|.*\|$/)) {
      const tableLines = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].match(/^\|.*\|$/)) {
        tableLines.push(lines[j]);
        j++;
      }
      processedLines.push(processTable(tableLines, footnotes));
      i = j - 1;
    } else if (trimmedLine === "") {
      continue;
    } else {
      processedLines.push(`<p>${processInline(line, footnotes)}</p>`);
    }
  }

  if (inUnorderedList) processedLines.push("</ul>");
  if (inTaskList) processedLines.push("</ul>");
  if (inOrderedList) processedLines.push("</ol>");
  if (inBlockquote) processedLines.push("</blockquote>");
  if (inCodeBlock) {
    const lang = normalizeCodeFenceLanguage(codeBlockLanguage || "plaintext");
    const escaped = escapeHtml(codeBlockContent.trim());
    processedLines.push(`<pre><code class="language-${lang}">${escaped}</code></pre>`);
  }

  if (footnotes.length > 0) {
    processedLines.push('<div class="footnotes">');
    processedLines.push("<hr />");
    processedLines.push("<ol>");
    for (const footnote of footnotes) {
      processedLines.push(
        `<li id="fn-${footnote.id}"><span>${processInline(footnote.text, footnotes)}</span> <a href="#fnref-${footnote.id}" class="footnote-backref">↩</a></li>`,
      );
    }
    processedLines.push("</ol>");
    processedLines.push("</div>");
  }

  if (frontMatterMode === "render") {
    const frontMatterHtml = renderFrontMatter(frontMatter);
    if (frontMatterHtml) {
      processedLines.unshift(frontMatterHtml);
    }
  }

  const rawHtml = processedLines.join("\n");
  return DOMPurify.sanitize(rawHtml);
}

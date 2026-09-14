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

interface MarkdownLink {
  destination: string;
  title?: string;
}

type MarkdownLinks = Map<string, MarkdownLink>;

function normalizeLinkLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function extractLinkDefinitions(lines: string[]): { lines: string[]; links: MarkdownLinks } {
  const links: MarkdownLinks = new Map();
  const body = [...lines];
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const definition = line.match(/^ {0,3}\[([^\]^]+)\]:\s*(.*)$/);
    if (!definition) continue;
    const nextLine = !definition[2] ? lines[index + 1]?.trim() : undefined;
    const value = (definition[2] || nextLine || "").match(
      /^(?:<([^<>]*)>|(\S+?))(?:\s+["'](.*)["'])?\s*$/,
    );
    if (!value) continue;
    const label = normalizeLinkLabel(definition[1]);
    if (!links.has(label)) links.set(label, { destination: value[1] ?? value[2], title: value[3] });
    body[index] = "";
    if (nextLine !== undefined) body[++index] = "";
  }
  return { lines: body, links };
}

function processInline(text: string, footnotes: Footnote[], links: MarkdownLinks): string {
  const protectedSegments: string[] = [];
  const protect = (html: string): string => {
    const token = `\u0000ATHAS${protectedSegments.length}\u0000`;
    protectedSegments.push(html);
    return token;
  };

  const reference = (match: string, label: string, id: string | undefined, image: boolean) => {
    const link = links.get(normalizeLinkLabel(id || label));
    if (!link) return match;
    const title = link.title ? ` title="${escapeAttribute(link.title)}"` : "";
    const destination = escapeAttribute(link.destination);
    return protect(
      image
        ? `<img src="${destination}" alt="${escapeAttribute(label)}"${title} />`
        : `<a href="${destination}"${title} target="_blank" rel="noopener noreferrer">${applyInlineFormatting(label)}</a>`,
    );
  };

  let processed = text
    .replace(/`([^`]+)`/g, (_, code) => protect(`<code>${escapeHtml(code)}</code>`))
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>|<[^>]+>/gi, (html) => protect(html))
    .replace(/!\[([^\]]*)\](?:\[([^\]]*)\])?(?![[(])/g, (match, label, id) =>
      reference(match, label, id, true),
    )
    .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (match, label, id) => reference(match, label, id, false))
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

  processed = processed.replace(/\[([^\]^]+)\](?![[(])/g, (match, label) =>
    reference(match, label, undefined, false),
  );
  processed = applyInlineFormatting(processed);

  for (let index = protectedSegments.length - 1; index >= 0; index--) {
    processed = processed.split(`\u0000ATHAS${index}\u0000`).join(protectedSegments[index]);
  }

  return processed;
}

function processTable(lines: string[], footnotes: Footnote[], links: MarkdownLinks): string {
  if (lines.length < 2) return lines.join("\n");

  const tableHtml: string[] = ["<table>"];

  const headerCells = lines[0]
    .split("|")
    .filter((cell) => cell.trim() !== "")
    .map((cell) => `<th>${processInline(cell.trim(), footnotes, links)}</th>`);
  tableHtml.push(`<thead><tr>${headerCells.join("")}</tr></thead>`);

  if (lines.length > 2) {
    tableHtml.push("<tbody>");
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i]
        .split("|")
        .filter((cell) => cell.trim() !== "")
        .map((cell) => `<td>${processInline(cell.trim(), footnotes, links)}</td>`);
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

const MARKDOWN_ALERT_TYPES = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
} as const;

/**
 * Renders the inner lines of a `>` block. The content is parsed as a full
 * document, so headings, lists, code fences and nested quotes all work, and a
 * leading `[!NOTE]`-style marker turns the quote into a GitHub alert.
 */
function renderBlockquote(quotedLines: string[]): string {
  const firstLine = quotedLines[0]?.trim() ?? "";
  const alertMatch = firstLine.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
  const alertType = alertMatch
    ? (alertMatch[1].toUpperCase() as keyof typeof MARKDOWN_ALERT_TYPES)
    : null;
  const bodyLines = alertType ? quotedLines.slice(1) : quotedLines;
  const inner = parseMarkdown(bodyLines.join("\n"), { frontMatter: "preserve" });

  if (!alertType) return `<blockquote>\n${inner}\n</blockquote>`;

  const className = `markdown-alert markdown-alert-${alertType.toLowerCase()}`;
  const title = MARKDOWN_ALERT_TYPES[alertType];
  return `<div class="${className}">\n<p class="markdown-alert-title">${title}</p>\n${inner}\n</div>`;
}

export function parseMarkdown(content: string, options: ParseMarkdownOptions = {}): string {
  const frontMatterMode = options.frontMatter ?? "preserve";
  const { frontMatter, body } =
    frontMatterMode === "preserve"
      ? { frontMatter: [], body: content }
      : extractYamlFrontMatter(content);
  const { lines, links } = extractLinkDefinitions(body.split("\n"));
  const processedLines: string[] = [];
  const footnotes: Footnote[] = [];
  let inUnorderedList = false;
  let inOrderedList = false;
  let inTaskList = false;
  let inCodeBlock = false;
  let codeBlockContent = "";
  let codeBlockLanguage = "";
  const isTaskListLine = (value: string) => /^\s*[-*+]\s\[([ xX])\]\s/.test(value);
  const isUnorderedListLine = (value: string) => /^\s*[-*+]\s/.test(value);
  const isOrderedListLine = (value: string) => /^\s*\d+\.\s/.test(value);
  const isBlockquoteLine = (value: string) => value.startsWith(">");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!inCodeBlock) {
      if (
        inUnorderedList &&
        (trimmedLine === "" || !isUnorderedListLine(line) || isTaskListLine(line))
      ) {
        processedLines.push("</ul>");
        inUnorderedList = false;
      }
      if (inTaskList && (trimmedLine === "" || !isTaskListLine(line))) {
        processedLines.push("</ul>");
        inTaskList = false;
      }
      if (inOrderedList && (trimmedLine === "" || !isOrderedListLine(line))) {
        processedLines.push("</ol>");
        inOrderedList = false;
      }
    }

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

    // Preserve raw HTML blocks (e.g., <details>, <summary>, <table>) as-is
    if (trimmedLine.startsWith("<") && trimmedLine.endsWith(">")) {
      processedLines.push(trimmedLine);
      continue;
    }

    if (line.match(/^######\s/)) {
      processedLines.push(
        `<h6>${processInline(line.replace(/^######\s/, ""), footnotes, links)}</h6>`,
      );
    } else if (line.match(/^#####\s/)) {
      processedLines.push(
        `<h5>${processInline(line.replace(/^#####\s/, ""), footnotes, links)}</h5>`,
      );
    } else if (line.match(/^####\s/)) {
      processedLines.push(
        `<h4>${processInline(line.replace(/^####\s/, ""), footnotes, links)}</h4>`,
      );
    } else if (line.match(/^###\s/)) {
      processedLines.push(
        `<h3>${processInline(line.replace(/^###\s/, ""), footnotes, links)}</h3>`,
      );
    } else if (line.match(/^##\s/)) {
      processedLines.push(`<h2>${processInline(line.replace(/^##\s/, ""), footnotes, links)}</h2>`);
    } else if (line.match(/^#\s/)) {
      processedLines.push(`<h1>${processInline(line.replace(/^#\s/, ""), footnotes, links)}</h1>`);
    } else if (line.match(/^(---+|___+|\*\*\*+)$/)) {
      processedLines.push("<hr />");
    } else if (isBlockquoteLine(line)) {
      const quotedLines: string[] = [];
      let j = i;
      while (j < lines.length && isBlockquoteLine(lines[j])) {
        quotedLines.push(lines[j].replace(/^>\s?/, ""));
        j++;
      }
      processedLines.push(renderBlockquote(quotedLines));
      i = j - 1;
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
          `<li class="task-list-item"><input type="checkbox" ${checked ? "checked" : ""} disabled /> ${processInline(taskContent, footnotes, links)}</li>`,
        );
      }
    } else if (isUnorderedListLine(line)) {
      if (!inUnorderedList) {
        processedLines.push("<ul>");
        inUnorderedList = true;
      }
      processedLines.push(
        `<li>${processInline(line.replace(/^\s*[-*+]\s/, ""), footnotes, links)}</li>`,
      );
    } else if (isOrderedListLine(line)) {
      if (!inOrderedList) {
        processedLines.push("<ol>");
        inOrderedList = true;
      }
      processedLines.push(
        `<li>${processInline(line.replace(/^\s*\d+\.\s/, ""), footnotes, links)}</li>`,
      );
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
      processedLines.push(processTable(tableLines, footnotes, links));
      i = j - 1;
    } else if (trimmedLine === "") {
      continue;
    } else {
      processedLines.push(`<p>${processInline(line, footnotes, links)}</p>`);
    }
  }

  if (inUnorderedList) processedLines.push("</ul>");
  if (inTaskList) processedLines.push("</ul>");
  if (inOrderedList) processedLines.push("</ol>");
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
        `<li id="fn-${footnote.id}"><span>${processInline(footnote.text, footnotes, links)}</span> <a href="#fnref-${footnote.id}" class="footnote-backref">↩</a></li>`,
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

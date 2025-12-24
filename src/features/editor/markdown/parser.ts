import { normalizeLanguage } from "./language-map";
import { highlightCode } from "./prism-languages";

interface Footnote {
  id: string;
  text: string;
}

function processInline(text: string, footnotes: Footnote[]): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[\^([^\]]+)\]/g, (match, id) => {
      const footnoteIndex = footnotes.findIndex((fn) => fn.id === id);
      if (footnoteIndex !== -1) {
        return `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}">${footnoteIndex + 1}</a></sup>`;
      }
      return match;
    })
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
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

export function parseMarkdown(content: string): string {
  const lines = content.split("\n");
  const processedLines: string[] = [];
  const footnotes: Footnote[] = [];
  let inUnorderedList = false;
  let inOrderedList = false;
  let inTaskList = false;
  let inCodeBlock = false;
  let inBlockquote = false;
  let codeBlockContent = "";
  let codeBlockLanguage = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^```/)) {
      if (inCodeBlock) {
        const rawLang = codeBlockLanguage || "plaintext";
        const lang = normalizeLanguage(rawLang);
        const highlighted = highlightCode(codeBlockContent.trim(), lang);
        processedLines.push(`<pre><code class="language-${lang}">${highlighted}</code></pre>`);
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

    if (inUnorderedList && !line.match(/^\s*[-*+]\s/)) {
      processedLines.push("</ul>");
      inUnorderedList = false;
    }
    if (inTaskList && !line.match(/^\s*[-*+]\s\[([ xX])\]\s/)) {
      processedLines.push("</ul>");
      inTaskList = false;
    }
    if (inOrderedList && !line.match(/^\s*\d+\.\s/)) {
      processedLines.push("</ol>");
      inOrderedList = false;
    }
    if (inBlockquote && !line.match(/^>\s/)) {
      processedLines.push("</blockquote>");
      inBlockquote = false;
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
    } else if (line.match(/^>\s/)) {
      if (!inBlockquote) {
        processedLines.push("<blockquote>");
        inBlockquote = true;
      }
      processedLines.push(`<p>${processInline(line.replace(/^>\s/, ""), footnotes)}</p>`);
    } else if (line.match(/^\s*[-*+]\s\[([ xX])\]\s/)) {
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
    } else if (line.match(/^\s*[-*+]\s/)) {
      if (!inUnorderedList) {
        processedLines.push("<ul>");
        inUnorderedList = true;
      }
      processedLines.push(`<li>${processInline(line.replace(/^\s*[-*+]\s/, ""), footnotes)}</li>`);
    } else if (line.match(/^\s*\d+\.\s/)) {
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
    } else if (line.trim() === "") {
      processedLines.push("<br />");
    } else {
      processedLines.push(`<p>${processInline(line, footnotes)}</p>`);
    }
  }

  if (inUnorderedList) processedLines.push("</ul>");
  if (inTaskList) processedLines.push("</ul>");
  if (inOrderedList) processedLines.push("</ol>");
  if (inBlockquote) processedLines.push("</blockquote>");
  if (inCodeBlock) {
    const rawLang = codeBlockLanguage || "plaintext";
    const lang = normalizeLanguage(rawLang);
    const highlighted = highlightCode(codeBlockContent.trim(), lang);
    processedLines.push(`<pre><code class="language-${lang}">${highlighted}</code></pre>`);
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

  return processedLines.join("\n");
}

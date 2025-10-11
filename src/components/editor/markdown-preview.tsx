import Prism from "prismjs";
// Load in dependency order
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-shell-session";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-css";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-toml";
import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/settings/store";
import { useBufferStore } from "@/stores/buffer-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";

export function MarkdownPreview() {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);
  const fontSize = useEditorSettingsStore.use.fontSize();
  const uiFontFamily = useSettingsStore((state) => state.settings.uiFontFamily);
  const [html, setHtml] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Normalize language names for Prism
  const normalizeLanguage = (lang: string): string => {
    const languageMap: Record<string, string> = {
      ts: "typescript",
      js: "javascript",
      py: "python",
      rb: "ruby",
      rs: "rust",
      sh: "bash",
      yml: "yaml",
      md: "markdown",
      cs: "csharp",
    };
    return languageMap[lang.toLowerCase()] || lang.toLowerCase();
  };

  useEffect(() => {
    if (!activeBuffer) return;

    const content = activeBuffer.content;
    const lines = content.split("\n");
    const processedLines: string[] = [];
    const localFootnotes: { id: string; text: string }[] = [];
    let inUnorderedList = false;
    let inOrderedList = false;
    let inTaskList = false;
    let inCodeBlock = false;
    let inBlockquote = false;
    let codeBlockContent = "";
    let codeBlockLanguage = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle code blocks
      if (line.match(/^```/)) {
        if (inCodeBlock) {
          // End code block - use Prism for syntax highlighting
          const rawLang = codeBlockLanguage || "plaintext";
          const lang = normalizeLanguage(rawLang);

          try {
            const grammar = Prism.languages[lang];
            if (grammar) {
              const highlightedCode = Prism.highlight(codeBlockContent.trim(), grammar, lang);
              processedLines.push(
                `<pre><code class="language-${lang}">${highlightedCode}</code></pre>`,
              );
            } else {
              // Fallback to plain code if language not found
              const escapedCode = codeBlockContent
                .trim()
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
              processedLines.push(
                `<pre><code class="language-${lang}">${escapedCode}</code></pre>`,
              );
            }
          } catch {
            // Fallback to plain code on error
            const escapedCode = codeBlockContent
              .trim()
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            processedLines.push(`<pre><code class="language-${lang}">${escapedCode}</code></pre>`);
          }

          codeBlockContent = "";
          codeBlockLanguage = "";
          inCodeBlock = false;
        } else {
          // Start code block
          codeBlockLanguage = line.replace(/^```/, "").trim();
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent += `${line}\n`;
        continue;
      }

      // Close lists when appropriate
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

      // Headers
      if (line.match(/^######\s/)) {
        processedLines.push(
          `<h6>${processInline(line.replace(/^######\s/, ""), localFootnotes)}</h6>`,
        );
      } else if (line.match(/^#####\s/)) {
        processedLines.push(
          `<h5>${processInline(line.replace(/^#####\s/, ""), localFootnotes)}</h5>`,
        );
      } else if (line.match(/^####\s/)) {
        processedLines.push(
          `<h4>${processInline(line.replace(/^####\s/, ""), localFootnotes)}</h4>`,
        );
      } else if (line.match(/^###\s/)) {
        processedLines.push(
          `<h3>${processInline(line.replace(/^###\s/, ""), localFootnotes)}</h3>`,
        );
      } else if (line.match(/^##\s/)) {
        processedLines.push(`<h2>${processInline(line.replace(/^##\s/, ""), localFootnotes)}</h2>`);
      } else if (line.match(/^#\s/)) {
        processedLines.push(`<h1>${processInline(line.replace(/^#\s/, ""), localFootnotes)}</h1>`);
      }
      // Horizontal rule
      else if (line.match(/^(---+|___+|\*\*\*+)$/)) {
        processedLines.push("<hr />");
      }
      // Blockquote
      else if (line.match(/^>\s/)) {
        if (!inBlockquote) {
          processedLines.push("<blockquote>");
          inBlockquote = true;
        }
        processedLines.push(`<p>${processInline(line.replace(/^>\s/, ""), localFootnotes)}</p>`);
      }
      // Task list item (- [ ] or - [x])
      else if (line.match(/^\s*[-*+]\s\[([ xX])\]\s/)) {
        if (!inTaskList) {
          processedLines.push('<ul class="task-list">');
          inTaskList = true;
        }
        const match = line.match(/^\s*[-*+]\s\[([ xX])\]\s(.*)$/);
        if (match) {
          const checked = match[1].toLowerCase() === "x";
          const content = match[2];
          processedLines.push(
            `<li class="task-list-item"><input type="checkbox" ${checked ? "checked" : ""} disabled /> ${processInline(content, localFootnotes)}</li>`,
          );
        }
      }
      // Unordered list
      else if (line.match(/^\s*[-*+]\s/)) {
        if (!inUnorderedList) {
          processedLines.push("<ul>");
          inUnorderedList = true;
        }
        processedLines.push(
          `<li>${processInline(line.replace(/^\s*[-*+]\s/, ""), localFootnotes)}</li>`,
        );
      }
      // Ordered list
      else if (line.match(/^\s*\d+\.\s/)) {
        if (!inOrderedList) {
          processedLines.push("<ol>");
          inOrderedList = true;
        }
        processedLines.push(
          `<li>${processInline(line.replace(/^\s*\d+\.\s/, ""), localFootnotes)}</li>`,
        );
      }
      // Footnote definition [^1]: text
      else if (line.match(/^\[\^([^\]]+)\]:\s(.+)$/)) {
        const match = line.match(/^\[\^([^\]]+)\]:\s(.+)$/);
        if (match) {
          localFootnotes.push({ id: match[1], text: match[2] });
        }
      }
      // Table detection
      else if (line.match(/^\|.*\|$/)) {
        const tableLines = [line];
        let j = i + 1;
        while (j < lines.length && lines[j].match(/^\|.*\|$/)) {
          tableLines.push(lines[j]);
          j++;
        }
        processedLines.push(processTable(tableLines, localFootnotes));
        i = j - 1;
      }
      // Empty line
      else if (line.trim() === "") {
        processedLines.push("<br />");
      }
      // Regular paragraph
      else {
        processedLines.push(`<p>${processInline(line, localFootnotes)}</p>`);
      }
    }

    // Close any open tags
    if (inUnorderedList) processedLines.push("</ul>");
    if (inTaskList) processedLines.push("</ul>");
    if (inOrderedList) processedLines.push("</ol>");
    if (inBlockquote) processedLines.push("</blockquote>");
    if (inCodeBlock) {
      const rawLang = codeBlockLanguage || "plaintext";
      const lang = normalizeLanguage(rawLang);

      try {
        const grammar = Prism.languages[lang];
        if (grammar) {
          const highlightedCode = Prism.highlight(codeBlockContent.trim(), grammar, lang);
          processedLines.push(
            `<pre><code class="language-${lang}">${highlightedCode}</code></pre>`,
          );
        } else {
          const escapedCode = codeBlockContent
            .trim()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          processedLines.push(`<pre><code class="language-${lang}">${escapedCode}</code></pre>`);
        }
      } catch {
        const escapedCode = codeBlockContent
          .trim()
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        processedLines.push(`<pre><code class="language-${lang}">${escapedCode}</code></pre>`);
      }
    }

    // Add footnotes section if any exist
    if (localFootnotes.length > 0) {
      processedLines.push('<div class="footnotes">');
      processedLines.push("<hr />");
      processedLines.push("<ol>");
      for (const footnote of localFootnotes) {
        processedLines.push(
          `<li id="fn-${footnote.id}"><span>${processInline(footnote.text, localFootnotes)}</span> <a href="#fnref-${footnote.id}" class="footnote-backref">↩</a></li>`,
        );
      }
      processedLines.push("</ol>");
      processedLines.push("</div>");
    }

    setHtml(processedLines.join("\n"));
  }, [activeBuffer?.content]);

  // Process inline markdown (bold, italic, code, links, images, strikethrough, footnotes)
  function processInline(text: string, footnotes: { id: string; text: string }[]): string {
    return (
      text
        // Images (must come before links)
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
        // Footnote references [^1]
        .replace(/\[\^([^\]]+)\]/g, (match, id) => {
          const footnoteIndex = footnotes.findIndex((fn) => fn.id === id);
          if (footnoteIndex !== -1) {
            return `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}">${footnoteIndex + 1}</a></sup>`;
          }
          return match;
        })
        // Links (must come after footnotes to avoid conflicts)
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
        )
        // Bold (** or __)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        // Italic (* or _)
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/_([^_]+)_/g, "<em>$1</em>")
        // Strikethrough
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        // Inline code
        .replace(/`([^`]+)`/g, "<code>$1</code>")
    );
  }

  // Process tables
  function processTable(lines: string[], footnotes: { id: string; text: string }[]): string {
    if (lines.length < 2) return lines.join("\n");

    const tableHtml: string[] = ["<table>"];

    // Header row
    const headerCells = lines[0]
      .split("|")
      .filter((cell) => cell.trim() !== "")
      .map((cell) => `<th>${processInline(cell.trim(), footnotes)}</th>`);
    tableHtml.push(`<thead><tr>${headerCells.join("")}</tr></thead>`);

    // Body rows (skip separator line at index 1)
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

  return (
    <div
      ref={containerRef}
      className="markdown-preview h-full overflow-auto bg-primary-bg p-8"
      style={{
        fontSize: `${fontSize}px`,
        fontFamily: `${uiFontFamily}, sans-serif`,
      }}
    >
      <div className="markdown-content max-w-4xl" dangerouslySetInnerHTML={{ __html: html }} />
      <style>{`
        .markdown-preview {
          color: var(--color-text);
          line-height: 1.6;
        }

        .markdown-content {
          width: 100%;
        }

        /* Headers */
        .markdown-preview h1 {
          font-size: 1.75em;
          font-weight: 700;
          margin: 0.75em 0 0.35em 0;
          padding-bottom: 0.2em;
          border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
          color: var(--color-text);
          line-height: 1.2;
        }
        .markdown-preview h1:first-child {
          margin-top: 0;
        }
        .markdown-preview h2 {
          font-size: 1.5em;
          font-weight: 700;
          margin: 0.65em 0 0.3em 0;
          padding-bottom: 0.2em;
          border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
          color: var(--color-text);
          line-height: 1.25;
        }
        .markdown-preview h3 {
          font-size: 1.25em;
          font-weight: 600;
          margin: 0.6em 0 0.3em 0;
          color: var(--color-text);
          line-height: 1.3;
        }
        .markdown-preview h4 {
          font-size: 1.1em;
          font-weight: 600;
          margin: 0.5em 0 0.25em 0;
          color: var(--color-text);
          line-height: 1.4;
        }
        .markdown-preview h5 {
          font-size: 1em;
          font-weight: 600;
          margin: 0.5em 0 0.25em 0;
          color: var(--color-text);
        }
        .markdown-preview h6 {
          font-size: 0.95em;
          font-weight: 600;
          margin: 0.5em 0 0.25em 0;
          color: var(--color-text-light);
        }

        /* Paragraphs */
        .markdown-preview p {
          margin: 0.5em 0;
          line-height: 1.6;
        }

        /* Inline code */
        .markdown-preview code {
          background-color: var(--color-hover, rgba(255, 255, 255, 0.1));
          padding: 0.2em 0.4em;
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.9em;
          color: var(--color-syntax-string, #c3e88d);
        }

        /* Code blocks */
        .markdown-preview pre {
          background-color: var(--color-secondary-bg, rgba(0, 0, 0, 0.2));
          padding: 1em;
          border-radius: 6px;
          overflow-x: auto;
          margin: 0.75em 0;
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
        }
        .markdown-preview pre code {
          background-color: transparent;
          padding: 0;
          border-radius: 0;
          color: var(--color-text);
          font-size: 0.95em;
          line-height: 1.5;
        }

        /* Lists */
        .markdown-preview ul,
        .markdown-preview ol {
          margin: 0.5em 0;
          padding-left: 2em;
        }
        .markdown-preview ul {
          list-style-type: disc;
        }
        .markdown-preview ol {
          list-style-type: decimal;
        }
        .markdown-preview li {
          margin: 0.25em 0;
          line-height: 1.5;
        }
        .markdown-preview li > ul,
        .markdown-preview li > ol {
          margin: 0.25em 0;
        }

        /* Links */
        .markdown-preview a {
          color: var(--color-accent, #82aaff);
          text-decoration: none;
          border-bottom: 1px solid transparent;
          transition: all 0.2s ease;
        }
        .markdown-preview a:hover {
          border-bottom-color: var(--color-accent, #82aaff);
        }

        /* Text formatting */
        .markdown-preview strong {
          font-weight: 700;
          color: var(--color-text);
        }
        .markdown-preview em {
          font-style: italic;
        }
        .markdown-preview del {
          text-decoration: line-through;
          opacity: 0.7;
        }

        /* Blockquotes */
        .markdown-preview blockquote {
          margin: 0.75em 0;
          padding: 0.5em 1em;
          border-left: 4px solid var(--color-accent, #82aaff);
          background-color: var(--color-hover, rgba(255, 255, 255, 0.05));
          color: var(--color-text-light);
          font-style: italic;
        }
        .markdown-preview blockquote p {
          margin: 0.25em 0;
        }

        /* Horizontal rules */
        .markdown-preview hr {
          margin: 1em 0;
          border: none;
          border-top: 2px solid var(--color-border, rgba(255, 255, 255, 0.1));
        }

        /* Images */
        .markdown-preview img {
          max-width: 100%;
          height: auto;
          border-radius: 6px;
          margin: 0.75em 0;
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
        }

        /* Tables */
        .markdown-preview table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.75em 0;
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
        }
        .markdown-preview th {
          background-color: var(--color-hover, rgba(255, 255, 255, 0.1));
          padding: 0.75em 1em;
          text-align: left;
          font-weight: 600;
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
        }
        .markdown-preview td {
          padding: 0.75em 1em;
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
        }
        .markdown-preview tr:nth-child(even) {
          background-color: var(--color-hover, rgba(255, 255, 255, 0.03));
        }
        .markdown-preview tr:hover {
          background-color: var(--color-hover, rgba(255, 255, 255, 0.08));
        }

        /* Line breaks */
        .markdown-preview br {
          display: block;
          content: "";
          margin: 0.25em 0;
        }

        /* Task Lists */
        .markdown-preview ul.task-list {
          list-style: none;
          padding-left: 1.5em;
        }
        .markdown-preview .task-list-item {
          display: flex;
          align-items: flex-start;
          gap: 0.5em;
          margin: 0.25em 0;
        }
        .markdown-preview .task-list-item input[type="checkbox"] {
          margin-top: 0.3em;
          cursor: default;
        }

        /* Footnotes */
        .markdown-preview .footnote-ref {
          font-size: 0.85em;
        }
        .markdown-preview .footnote-ref a {
          text-decoration: none;
          color: var(--color-accent, #82aaff);
          font-weight: 600;
        }
        .markdown-preview .footnote-ref a:hover {
          text-decoration: underline;
        }
        .markdown-preview .footnotes {
          margin-top: 2em;
          padding-top: 1em;
          border-top: 2px solid var(--color-border, rgba(255, 255, 255, 0.1));
          font-size: 0.9em;
          color: var(--color-text-lighter);
        }
        .markdown-preview .footnotes ol {
          padding-left: 1.5em;
        }
        .markdown-preview .footnotes li {
          margin: 0.5em 0;
        }
        .markdown-preview .footnote-backref {
          text-decoration: none;
          color: var(--color-accent, #82aaff);
          font-weight: 600;
        }
        .markdown-preview .footnote-backref:hover {
          text-decoration: underline;
        }

        /* Prism Syntax Highlighting */
        .markdown-preview .token.comment,
        .markdown-preview .token.prolog,
        .markdown-preview .token.doctype,
        .markdown-preview .token.cdata {
          color: var(--color-syntax-comment, #676e95);
          font-style: italic;
        }
        .markdown-preview .token.punctuation {
          color: var(--color-text, #c8d3f5);
        }
        .markdown-preview .token.property,
        .markdown-preview .token.tag,
        .markdown-preview .token.boolean,
        .markdown-preview .token.number,
        .markdown-preview .token.constant,
        .markdown-preview .token.symbol,
        .markdown-preview .token.deleted {
          color: var(--color-syntax-number, #ff9e64);
        }
        .markdown-preview .token.selector,
        .markdown-preview .token.attr-name,
        .markdown-preview .token.string,
        .markdown-preview .token.char,
        .markdown-preview .token.builtin,
        .markdown-preview .token.inserted {
          color: var(--color-syntax-string, #c3e88d);
        }
        .markdown-preview .token.operator,
        .markdown-preview .token.entity,
        .markdown-preview .token.url,
        .markdown-preview .language-css .token.string,
        .markdown-preview .style .token.string {
          color: var(--color-syntax-operator, #89ddff);
        }
        .markdown-preview .token.atrule,
        .markdown-preview .token.attr-value,
        .markdown-preview .token.keyword {
          color: var(--color-syntax-keyword, #c792ea);
        }
        .markdown-preview .token.function,
        .markdown-preview .token.class-name {
          color: var(--color-syntax-function, #82aaff);
        }
        .markdown-preview .token.regex,
        .markdown-preview .token.important,
        .markdown-preview .token.variable {
          color: var(--color-syntax-variable, #f78c6c);
        }
      `}</style>
    </div>
  );
}

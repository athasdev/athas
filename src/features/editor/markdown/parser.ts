import DOMPurify from "dompurify";
import {
  renderMarkdown,
  type ParseMarkdownOptions,
  type UnsanitizedMarkdown,
} from "./render-markdown";

export type { ParseMarkdownOptions };

export function sanitizeMarkdown(markdown: UnsanitizedMarkdown): string {
  let html = "";
  for (const part of markdown.parts) {
    html += typeof part === "string" ? part : sanitizeMarkdown(part);
  }
  return DOMPurify.sanitize(html);
}

export function parseMarkdown(content: string, options: ParseMarkdownOptions = {}): string {
  return sanitizeMarkdown(renderMarkdown(content, options));
}

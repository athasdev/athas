import { highlightMarkdownCodeBlocks } from "@/features/editor/markdown/code-highlight";
import { parseMarkdown } from "@/features/editor/markdown/parser";

/**
 * Fills an element with rendered markdown from a language server (hover text, completion docs,
 * signature docs). Code blocks show plain first and are highlighted once their tokens arrive, as
 * long as the element still shows the same text.
 */
function renderMarkdownContent(element: HTMLElement, markdown: string) {
  const html = parseMarkdown(markdown);
  element.innerHTML = html;
  element.dataset.markdown = markdown;
  if (!html.includes("<pre><code")) return;
  void highlightMarkdownCodeBlocks(html)
    .then((highlighted) => {
      if (highlighted !== html && element.dataset.markdown === markdown) {
        element.innerHTML = highlighted;
      }
    })
    .catch(() => {});
}

/** A markdown block element with the shared LSP markdown styling. */
export function createMarkdownElement(markdown: string, className = "") {
  const element = document.createElement("div");
  element.className = `cm-athas-markdown ${className}`.trim();
  renderMarkdownContent(element, markdown);
  return element;
}

/**
 * An element for LSP documentation: `MarkupContent` markdown is rendered, while plain strings and
 * plaintext content keep their text and line breaks as they are.
 */
export function createDocumentationElement(
  value: string | { kind?: string; value: string } | null | undefined,
  className = "",
): HTMLElement | null {
  if (!value) return null;
  if (typeof value !== "string" && value.kind === "markdown") {
    return value.value.trim() ? createMarkdownElement(value.value, className) : null;
  }
  const text = typeof value === "string" ? value : value.value;
  if (!text.trim()) return null;
  const element = document.createElement("div");
  element.className = `cm-athas-markdown cm-athas-plaintext ${className}`.trim();
  element.textContent = text;
  return element;
}

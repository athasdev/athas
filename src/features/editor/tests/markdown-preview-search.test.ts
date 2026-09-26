// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import {
  highlightMarkdownPreviewMatches,
  isEntireMarkdownPreviewSelected,
} from "../markdown/markdown-preview-search";

describe("Markdown preview search and selection", () => {
  it("highlights rendered text without matching HTML attributes or changing list markup", () => {
    const result = highlightMarkdownPreviewMatches(
      '<ul><li><a href="/alpha">Alpha</a> alpha</li></ul>',
      "alpha",
    );

    expect(result.matchCount).toBe(2);
    expect(result.html).toContain(
      '<a href="/alpha"><mark data-markdown-search-match="">Alpha</mark></a>',
    );
    expect(result.html).toContain("<li>");
    expect(result.html).not.toContain('<a href="/<mark');
  });

  it("treats search punctuation literally", () => {
    const result = highlightMarkdownPreviewMatches("<p>a.b acb</p>", "a.b");
    expect(result.matchCount).toBe(1);
  });

  it("recognizes a complete preview selection for Markdown source copying", () => {
    const content = document.createElement("div");
    content.innerHTML = "<h1>Title</h1><ul><li>Item</li></ul>";
    document.body.append(content);
    const selection = window.getSelection();
    expect(selection).not.toBeNull();
    if (!selection) return;

    const fullRange = document.createRange();
    fullRange.selectNodeContents(content);
    selection.addRange(fullRange);
    expect(isEntireMarkdownPreviewSelected(content, selection)).toBe(true);

    selection.removeAllRanges();
    const partialRange = document.createRange();
    partialRange.selectNodeContents(content.querySelector("li")!);
    selection.addRange(partialRange);
    expect(isEntireMarkdownPreviewSelected(content, selection)).toBe(false);

    selection.removeAllRanges();
    content.remove();
  });
});

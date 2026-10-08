// @vitest-environment jsdom
import DOMPurify from "dompurify";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  MarkdownSanitizeCache,
  SourceSanitizeCache,
  sanitizeMarkdown,
  sanitizeMarkdownBlocks,
} from "../markdown/services/parser";
import { renderMarkdown } from "../markdown/render-markdown";

const README = `---
title: Demo
---
<!-- generated -->
<p align="center"><img src="logo.png" alt="logo"></p>

# Demo

Some **bold** text, \`code\` and Vec<T> in prose[^1].

- one
- two

<details>
<summary>More</summary>

Hidden *paragraph*.

</details>

> [!NOTE]
> A note with <kbd>K</kbd>.

\`\`\`ts
const value = 1 < 2;
\`\`\`

| a | b |
|---|---|
| 1 | 2 |

[^1]: The footnote.
`;

const UNSAFE_SNIPPETS = [
  "<b>open",
  "<div>",
  "<!--",
  '<a href="x',
  "<textarea>",
  "<table>",
  "<select>",
  "<form>",
  "</body>",
  "<!doctype html>",
  "<style>",
  "<template>",
  "<svg>",
  "<foo>",
  "<plaintext>",
];

function blocksFor(text: string, cache = new MarkdownSanitizeCache()) {
  const markdown = renderMarkdown(text, { frontMatter: "render" });
  return { blocks: sanitizeMarkdownBlocks(markdown, cache), whole: sanitizeMarkdown(markdown) };
}

describe("block-wise markdown sanitizing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("splits a typical document into blocks that join to the whole-document result", () => {
    const { blocks, whole } = blocksFor(README);

    expect(blocks.join("")).toBe(whole);
    expect(blocks.length).toBeGreaterThan(8);
    expect(blocks.filter((block) => block.includes("<details>"))).toEqual([
      expect.stringContaining("</details>"),
    ]);
  });

  it("matches the whole-document result when raw HTML leaves the parser in another state", () => {
    for (const snippet of UNSAFE_SNIPPETS) {
      for (const text of [
        `${snippet}\n\n${README}`,
        `${README}\n${snippet}\n\nAfter`,
        `${README}\n${snippet}\n\n${README.slice(README.indexOf("# Demo"))}`,
        README.replace("Hidden", snippet),
        ["plain", snippet, "plain", "plain", "plain", "plain", "plain"].join("\n\n"),
      ]) {
        const { blocks, whole } = blocksFor(text);
        expect(blocks.join(""), `${snippet} in ${JSON.stringify(text.slice(0, 40))}`).toBe(whole);
      }
    }
  });

  it("sanitizes only the block an edit changed", () => {
    const cache = new MarkdownSanitizeCache();
    blocksFor(README, cache);
    const edited = renderMarkdown(README.replace("Hidden *paragraph*", "Hidden *paragraphs*"), {
      frontMatter: "render",
    });
    const sanitize = vi.spyOn(DOMPurify, "sanitize");

    const blocks = sanitizeMarkdownBlocks(edited, cache);

    expect(sanitize).toHaveBeenCalledTimes(1);
    expect(sanitize.mock.calls[0][0]).toContain("Hidden <em>paragraphs</em>");
    sanitize.mockRestore();
    expect(blocks.join("")).toBe(sanitizeMarkdown(edited));
  });

  it("sanitizes many new blocks in a few DOMPurify calls", () => {
    const text = Array.from({ length: 200 }, (_, index) => `Paragraph ${index} with *text*.`).join(
      "\n\n",
    );
    const markdown = renderMarkdown(text);
    const sanitize = vi.spyOn(DOMPurify, "sanitize");

    const blocks = sanitizeMarkdownBlocks(markdown, new MarkdownSanitizeCache());

    expect(blocks).toHaveLength(200);
    expect(sanitize.mock.calls.length).toBeLessThanOrEqual(3);
    sanitize.mockRestore();
    expect(blocks.join("")).toBe(sanitizeMarkdown(markdown));
  });

  it("does not accept a probe written in the document", () => {
    for (const text of [
      '# H\n<style></style><abbr data-athas-block-end="0"></abbr><textarea>\n</textarea><b>x</b>\na\n\nb\n\nc',
      '# a\n\n<style></style><abbr data-athas-block-end="0"></abbr><!-- >\n\n<b>shown only per-block</b>\n\n-->',
      '# a\n\n<p>x</p><textarea>\n\n<ABBR DATA-ATHAS-BLOCK-END="1"></ABBR>\n\ntail',
    ]) {
      const cache = new MarkdownSanitizeCache();
      for (let pass = 0; pass < 2; pass++) {
        const { blocks, whole } = blocksFor(text, cache);
        expect(blocks.join("")).toBe(whole);
      }
    }
  });

  it("empties a preview's cache when it shows another source", () => {
    const caches = new SourceSanitizeCache();
    const first = caches.forSource("/a.md");
    blocksFor(README, first);
    expect(first.peek("\n<h1>Demo</h1>", false)).toBeDefined();

    expect(caches.forSource("/b.md")).toBe(first);
    expect(first.peek("\n<h1>Demo</h1>", false)).toBeUndefined();
  });

  it("gives the whole document as one block when a block changes document-wide state", () => {
    const { blocks, whole } = blocksFor(`${README}\n<form>\n\nAfter`);

    expect(blocks).toEqual([whole]);
  });
});

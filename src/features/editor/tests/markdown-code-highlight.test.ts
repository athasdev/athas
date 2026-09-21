import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { yieldToMain } from "@/utils/yield-to-main";

vi.mock("@/utils/yield-to-main", () => ({ yieldToMain: vi.fn(async () => {}) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

vi.mock("@/features/editor/lib/wasm-parser/cache-indexeddb", () => ({
  indexedDBParserCache: {
    get: vi.fn(async () => null),
  },
}));

vi.mock("@/features/editor/lib/wasm-parser/extension-assets", () => ({
  fetchHighlightQuery: vi.fn(async () => ({ query: "" })),
  getLanguageAssetConfig: vi.fn(() => ({
    wasmPath: "/parser.wasm",
    highlightQueryUrl: "/highlights.scm",
  })),
}));

const { tokenize } = vi.hoisted(() => ({ tokenize: vi.fn() }));

vi.mock("@/features/editor/lib/wasm-parser/tokenizer-worker-client", () => ({
  tokenizerWorkerClient: { tokenize },
}));

import { highlightMarkdownCodeBlocks } from "../markdown/code-highlight";

describe("highlightMarkdownCodeBlocks", () => {
  it("processes code blocks in order and yields when the frame budget is spent", async () => {
    let clock = 1;
    let running = 0;
    let peak = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    tokenize.mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      clock += 10;
      running--;
      return { tokens: [], normalizedText: "" };
    });
    const html = await highlightMarkdownCodeBlocks(
      '<p>Before</p><pre><code class="language-python">first = 91</code></pre><p>Between</p><pre><code class="language-python">second = 92</code></pre><p>After</p>',
    );
    expect(peak).toBe(1);
    expect(yieldToMain).toHaveBeenCalledTimes(2);
    expect(html).toMatch(/^<p>Before<\/p>/);
    expect(html).toContain('</code></pre><p>Between</p><pre><code class="language-python">');
    expect(html).toMatch(/<p>After<\/p>$/);
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });

  it("leaves plain content unchanged without scheduling extra work", async () => {
    expect(await highlightMarkdownCodeBlocks("<p>Plain text</p>")).toBe("<p>Plain text</p>");
    expect(yieldToMain).not.toHaveBeenCalled();
  });

  it("uses fallback highlighting for R, Python, and SQL preview code blocks", async () => {
    tokenize.mockResolvedValue({ tokens: [], normalizedText: "" });
    const html = await highlightMarkdownCodeBlocks(
      [
        '<pre><code class="language-r">library(dplyr)\nvalue &lt;- 1</code></pre>',
        '<pre><code class="language-python">import pandas as pd\nprint("ok")</code></pre>',
        '<pre><code class="language-sql">select avg(score) from observations</code></pre>',
      ].join("\n"),
    );

    expect(html).toContain('class="token-function"');
    expect(html).toContain('class="token-keyword"');
    expect(html).toContain('class="token-number"');
    expect(html).toContain('class="language-r"');
    expect(html).toContain('class="language-python"');
    expect(html).toContain('class="language-sql"');
    expect(tokenize).toHaveBeenCalledTimes(3);
    expect(tokenize).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "full", content: expect.any(String) }),
    );
  });

  it("renders worker token offsets without changing the code text", async () => {
    tokenize.mockResolvedValueOnce({
      normalizedText: "const answer = 42;",
      tokens: [
        {
          type: "token-keyword",
          startIndex: 0,
          endIndex: 5,
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 5 },
        },
      ],
    });

    const html = await highlightMarkdownCodeBlocks(
      '<pre><code class="language-typescript">const answer = 42;</code></pre>',
      "markdown-test",
    );

    expect(html).toContain('<span class="token-keyword">const</span> answer = 42;');
    expect(tokenize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bufferId: "markdown-test:0",
        latestKey: "markdown-test:0",
        languageId: "typescript",
      }),
    );
  });
});

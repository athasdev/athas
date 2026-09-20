import { describe, expect, it, vi } from "vite-plus/test";

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

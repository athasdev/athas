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

vi.mock("@/features/editor/lib/wasm-parser/tokenizer", () => ({
  tokenizeCode: vi.fn(async () => []),
}));

import { highlightCodeBlock } from "../lsp/hover-tooltip-highlight";

describe("highlightCodeBlock", () => {
  it("uses fallback highlighting for R, Python, and SQL preview code blocks", async () => {
    const html = await highlightCodeBlock(
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
  });
});

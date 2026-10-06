import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { yieldToMain } from "@/utils/yield-to-main";
import { highlightMarkdownCodeBlocks } from "../markdown/code-highlight";

vi.mock("@/utils/yield-to-main", () => ({ yieldToMain: vi.fn(async () => {}) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("highlightMarkdownCodeBlocks", () => {
  it("highlights code blocks in order and yields when the frame budget is spent", async () => {
    let clock = 1;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 10));
    const html = await highlightMarkdownCodeBlocks(
      '<p>Before</p><pre><code class="language-python">first = 91</code></pre><p>Between</p><pre><code class="language-python">second = 92</code></pre><p>After</p>',
    );
    expect(yieldToMain).toHaveBeenCalledTimes(2);
    expect(html).toMatch(/^<p>Before<\/p>/);
    expect(html).toContain('</code></pre><p>Between</p><pre><code class="language-python">');
    expect(html).toMatch(/<p>After<\/p>$/);
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
    expect(html).toContain('<span class="token-number">91</span>');
  });

  it("leaves plain content unchanged without scheduling extra work", async () => {
    expect(await highlightMarkdownCodeBlocks("<p>Plain text</p>")).toBe("<p>Plain text</p>");
    expect(yieldToMain).not.toHaveBeenCalled();
  });

  it("highlights R, Python and SQL blocks with the editor's languages", async () => {
    const html = await highlightMarkdownCodeBlocks(
      [
        '<pre><code class="language-r">library(dplyr)\nvalue &lt;- 1</code></pre>',
        '<pre><code class="language-python">import pandas as pd\nprint("ok")</code></pre>',
        '<pre><code class="language-sql">select avg(score) from observations</code></pre>',
      ].join("\n"),
    );

    expect(html).toContain('<span class="token-keyword">import</span>');
    expect(html).toContain('<span class="token-string">"ok"</span>');
    expect(html).toContain('<span class="token-keyword">select</span>');
    expect(html).toContain('<span class="token-number">1</span>');
    expect(html).toContain('class="language-r"');
  });

  it("keeps the code text intact around highlighted tokens", async () => {
    const html = await highlightMarkdownCodeBlocks(
      '<pre><code class="language-typescript">const answer = 42;</code></pre>',
    );

    expect(html).toContain('<span class="token-keyword">const</span>');
    expect(html.replace(/<[^>]+>/g, "")).toBe("const answer = 42;");
  });
});

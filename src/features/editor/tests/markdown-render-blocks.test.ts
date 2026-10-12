import { describe, expect, it } from "vite-plus/test";
import { renderMarkdown, type UnsanitizedMarkdown } from "../markdown/render-markdown";

const join = (markdown: UnsanitizedMarkdown): string =>
  markdown.blocks
    .map((block) => block.map((part) => (typeof part === "string" ? part : join(part))).join(""))
    .join("");

const html = (markdown: string, options?: Parameters<typeof renderMarkdown>[1]) =>
  join(renderMarkdown(markdown, options));

describe("markdown rendering", () => {
  it("resolves reference links and images, keeping unknown references as text", () => {
    const output = html(
      [
        "See [the docs][docs], [Guide], ![logo][img] and [missing][nope].",
        "",
        '[docs]: https://athas.dev/docs "Athas Docs"',
        "[guide]:",
        "  <https://athas.dev/guide>",
        "[img]: /logo.png",
      ].join("\n"),
    );

    expect(output).toContain(
      '<a href="https://athas.dev/docs" title="Athas Docs" target="_blank" rel="noopener noreferrer">the docs</a>',
    );
    expect(output).toContain('<a href="https://athas.dev/guide" target="_blank"');
    expect(output).toContain('<img src="/logo.png" alt="logo" />');
    expect(output).toContain("[missing][nope]");
    expect(output).not.toContain("[docs]:");
  });

  it("does not treat link definitions inside code fences as definitions", () => {
    const output = html(["```", "[x]: https://example.com", "```", "[x]"].join("\n"));
    expect(output).toContain("[x]: https://example.com");
    expect(output).toContain("<p>[x]</p>");
  });

  it("renders every heading level, rules and inline images", () => {
    const output = html(
      ["###### six", "##### five", "#### four", "***", "![alt](/a.png) text"].join("\n"),
    );
    expect(output).toContain("<h6>six</h6>");
    expect(output).toContain("<h5>five</h5>");
    expect(output).toContain("<h4>four</h4>");
    expect(output).toContain("<hr />");
    expect(output).toContain('<img src="/a.png" alt="alt" />');
  });

  it("closes lists when other blocks follow and closes an unterminated code fence", () => {
    const output = html(
      ["- a", "- [x] done", "- [ ] todo", "1. first", "text", "```ts", "const a = 1;"].join("\n"),
    );

    expect(output).toMatch(/<ul>\s*<li>a<\/li>\s*<\/ul>/);
    expect(output).toContain('<ul class="task-list">');
    expect(output).toContain("checked disabled");
    expect(output).toMatch(/<ol>\s*<li>first<\/li>\s*<\/ol>/);
    expect(output).toMatch(/<pre><code class="language-[\w-]+">const a = 1;<\/code><\/pre>$/);
  });

  it("keeps raw HTML blocks and links footnote references to later definitions", () => {
    const output = html(
      [
        "<details>",
        "Note[^1] and[^2]",
        "",
        "[^1]: The footnote.",
        "```",
        "[^2]: in code",
        "```",
      ].join("\n"),
    );
    expect(output).toContain("<details>");
    expect(output).toContain('<a href="#fn-1" id="fnref-1">1</a>');
    expect(output).toContain("and[^2]");
    expect(output).toContain('<li id="fn-1"><span>The footnote.</span>');
    expect(output).not.toContain('id="fn-2"');
    expect(output).toContain("[^2]: in code");
  });

  it("renders nested front matter as properties and skips comments", () => {
    const output = html(
      [
        "---",
        "# comment",
        "title: Report",
        "params:",
        "  min: 1",
        "not a pair",
        "...",
        "Body",
      ].join("\n"),
      { frontMatter: "render" },
    );

    expect(output).toContain("Report");
    expect(output).toContain("params.min");
    expect(output).not.toContain("comment");
    expect(output).toContain("<p>Body</p>");
  });

  it("leaves unterminated front matter as content", () => {
    const output = html(["---", "title: x", "Body"].join("\n"), { frontMatter: "render" });
    expect(output).toContain("title: x");
  });
});

import type { Node } from "web-tree-sitter";
import { describe, expect, it } from "vite-plus/test";
import { getInjectionRules, resolveInjectedLanguage } from "../lib/wasm-parser/language-injections";

function nodeRange(startIndex: number, endIndex: number): Node {
  return { startIndex, endIndex } as Node;
}

describe("language injections", () => {
  it("uses shared rules for embedded HTML languages", () => {
    expect(getInjectionRules("html")).toEqual([
      { parentType: "script_element", contentType: "raw_text", language: "javascript" },
      { parentType: "style_element", contentType: "raw_text", language: "css" },
    ]);
  });

  it("injects fenced code blocks for Markdown and R Markdown", () => {
    expect(getInjectionRules("markdown")).toEqual([
      { parentType: "*", contentType: "html_block", language: "html" },
      { parentType: "fenced_code_block", contentType: "code_fence_content", language: "text" },
    ]);
    expect(getInjectionRules("rmarkdown")).toEqual([
      { parentType: "*", contentType: "html_block", language: "html" },
      { parentType: "fenced_code_block", contentType: "code_fence_content", language: "r" },
    ]);
  });

  it("resolves R Markdown chunk language from the code fence info string", () => {
    const source = "```{r cars}\nsummary(cars)\n```";
    const parentNode = nodeRange(0, source.length);
    const contentNode = nodeRange("```{r cars}\n".length, source.indexOf("\n```"));
    const fenceRule = getInjectionRules("rmarkdown")?.find(
      (rule) => rule.contentType === "code_fence_content",
    );

    expect(fenceRule).toBeDefined();
    expect(resolveInjectedLanguage(source, "rmarkdown", fenceRule!, contentNode, parentNode)).toBe(
      "r",
    );
  });

  it("resolves Python chunks in notebook-style Markdown fences", () => {
    const source = "```python\nimport pandas as pd\n```";
    const parentNode = nodeRange(0, source.length);
    const contentNode = nodeRange("```python\n".length, source.indexOf("\n```"));
    const fenceRule = getInjectionRules("markdown")?.find(
      (rule) => rule.contentType === "code_fence_content",
    );

    expect(fenceRule).toBeDefined();
    expect(resolveInjectedLanguage(source, "markdown", fenceRule!, contentNode, parentNode)).toBe(
      "python",
    );
  });

  it("marks untyped Markdown fences as plain text", () => {
    const source = "```\nplain text\n```";
    const parentNode = nodeRange(0, source.length);
    const contentNode = nodeRange("```\n".length, source.indexOf("\n```"));
    const fenceRule = getInjectionRules("markdown")?.find(
      (rule) => rule.contentType === "code_fence_content",
    );

    expect(fenceRule).toBeDefined();
    expect(resolveInjectedLanguage(source, "markdown", fenceRule!, contentNode, parentNode)).toBe(
      "text",
    );
  });

  it("resolves script lang aliases for embedded content", () => {
    const source = '<script lang="ts">const value = 1;</script>';
    const parentNode = nodeRange(0, source.length);
    const contentNode = nodeRange('<script lang="ts">'.length, source.indexOf("</script>"));
    const [scriptRule] = getInjectionRules("html") ?? [];

    expect(resolveInjectedLanguage(source, "html", scriptRule, contentNode, parentNode)).toBe(
      "typescript",
    );
  });

  it("keeps Svelte TSX script blocks distinct", () => {
    const source = '<script lang="tsx">export let value;</script>';
    const parentNode = nodeRange(0, source.length);
    const contentNode = nodeRange('<script lang="tsx">'.length, source.indexOf("</script>"));
    const [scriptRule] = getInjectionRules("svelte") ?? [];

    expect(resolveInjectedLanguage(source, "svelte", scriptRule, contentNode, parentNode)).toBe(
      "typescriptreact",
    );
  });
});

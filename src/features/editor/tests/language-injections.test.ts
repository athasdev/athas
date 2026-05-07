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

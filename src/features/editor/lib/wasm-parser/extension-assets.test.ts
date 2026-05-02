import { describe, expect, it } from "vite-plus/test";
import { getDefaultParserWasmUrl, getHighlightQueryCandidates } from "./extension-assets";

describe("extension-assets", () => {
  it("maps scheme assets to the bundled elisp parser", () => {
    expect(getDefaultParserWasmUrl("scheme")).toBe("/tree-sitter/parsers/elisp/parser.wasm");
    expect(getHighlightQueryCandidates("scheme")).toContain(
      "/tree-sitter/parsers/elisp/highlights.scm",
    );
  });
});

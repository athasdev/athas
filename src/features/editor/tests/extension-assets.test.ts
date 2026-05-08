import { describe, expect, it } from "vite-plus/test";
import {
  getDefaultParserWasmUrl,
  getHighlightQueryCandidates,
  getLanguageAssetConfig,
  registerLanguageAssetOverride,
  unregisterLanguageAssetOverride,
} from "../lib/wasm-parser/extension-assets";

describe("extension-assets", () => {
  it("maps scheme assets to the bundled elisp parser", () => {
    expect(getDefaultParserWasmUrl("scheme")).toBe("/tree-sitter/parsers/elisp/parser.wasm");
    expect(getHighlightQueryCandidates("scheme")).toContain(
      "/tree-sitter/parsers/elisp/highlights.scm",
    );
  });

  it("uses the bash parser with dotenv highlight queries for dotenv", () => {
    expect(getDefaultParserWasmUrl("dotenv")).toBe("/tree-sitter/parsers/bash/parser.wasm");
    expect(getHighlightQueryCandidates("dotenv")).toContain(
      "/tree-sitter/parsers/dotenv/highlights.scm",
    );
    expect(getHighlightQueryCandidates("dotenv", "/tree-sitter/parsers/bash/parser.wasm")[0]).toBe(
      "/tree-sitter/parsers/dotenv/highlights.scm",
    );
  });

  it("uses the css parser for css-family language ids", () => {
    for (const languageId of ["scss", "sass", "less"]) {
      expect(getDefaultParserWasmUrl(languageId)).toBe("/tree-sitter/parsers/css/parser.wasm");
      expect(getHighlightQueryCandidates(languageId)).toContain(
        "/tree-sitter/parsers/css/highlights.scm",
      );
    }
  });

  it("prefers registered manifest asset URLs", () => {
    registerLanguageAssetOverride("example", {
      wasmPath: "https://example.com/example/parser.wasm",
      highlightQueryUrl: "https://example.com/example/highlights.scm",
    });

    expect(getLanguageAssetConfig("example")).toMatchObject({
      wasmPath: "https://example.com/example/parser.wasm",
      highlightQueryUrl: "https://example.com/example/highlights.scm",
    });
    expect(getHighlightQueryCandidates("example")[0]).toBe(
      "https://example.com/example/highlights.scm",
    );

    unregisterLanguageAssetOverride("example");
  });
});

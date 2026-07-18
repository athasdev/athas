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

  it("reuses bundled parser assets for research document formats", () => {
    expect(getLanguageAssetConfig("rmarkdown")).toMatchObject({
      parserLanguageId: "markdown",
      queryLanguageId: "markdown",
      wasmPath: "/tree-sitter/parsers/markdown/parser.wasm",
      highlightQueryUrl: "/tree-sitter/parsers/markdown/highlights.scm",
    });
    expect(getLanguageAssetConfig("jupyter-notebook")).toMatchObject({
      parserLanguageId: "json",
      queryLanguageId: "json",
      wasmPath: "/tree-sitter/parsers/json/parser.wasm",
      highlightQueryUrl: "/tree-sitter/parsers/json/highlights.scm",
    });
    expect(getLanguageAssetConfig("r")).toMatchObject({
      parserLanguageId: "r",
      queryLanguageId: "r",
      wasmPath: "/tree-sitter/parsers/r/parser.wasm",
      highlightQueryUrl: "/tree-sitter/parsers/r/highlights.scm",
    });
  });

  it("resolves bundled parser assets for reported editor highlight languages", () => {
    expect(getLanguageAssetConfig("typescriptreact")).toMatchObject({
      parserLanguageId: "tsx",
      queryLanguageId: "tsx",
      wasmPath: "/tree-sitter/parsers/tsx/parser.wasm",
      highlightQueryUrl: "/tree-sitter/parsers/tsx/highlights.scm",
    });
    expect(getLanguageAssetConfig("zig")).toMatchObject({
      parserLanguageId: "zig",
      queryLanguageId: "zig",
      wasmPath: "/tree-sitter/parsers/zig/parser.wasm",
      highlightQueryUrl: "/tree-sitter/parsers/zig/highlights.scm",
    });
    expect(getLanguageAssetConfig("elm")).toMatchObject({
      parserLanguageId: "elm",
      queryLanguageId: "elm",
      wasmPath: "/tree-sitter/parsers/elm/parser.wasm",
      highlightQueryUrl: "/tree-sitter/parsers/elm/highlights.scm",
    });
    expect(getLanguageAssetConfig("elisp")).toMatchObject({
      parserLanguageId: "elisp",
      queryLanguageId: "elisp",
      wasmPath: "/tree-sitter/parsers/elisp/parser.wasm",
      highlightQueryUrl: "/tree-sitter/parsers/elisp/highlights.scm",
    });
    expect(getLanguageAssetConfig("astro")).toMatchObject({
      parserLanguageId: "astro",
      queryLanguageId: "astro",
      wasmPath: "/tree-sitter/parsers/astro/parser.wasm",
      highlightQueryUrl: "/tree-sitter/parsers/astro/highlights.scm",
    });
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

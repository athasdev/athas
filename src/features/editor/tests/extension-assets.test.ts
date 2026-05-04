import { describe, expect, it } from "vite-plus/test";
import {
  getDefaultParserWasmUrl,
  getHighlightQueryCandidates,
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
});

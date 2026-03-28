import { describe, expect, it } from "vite-plus/test";
import {
  getHighlightQueryUrl,
  getWasmUrlForLanguage,
  resolveLanguageAssetUrl,
} from "./language-packager";

describe("language-packager asset URL resolution", () => {
  it("resolves missing grammar assets to bundled parser paths", () => {
    expect(resolveLanguageAssetUrl("c", undefined, "parser.wasm")).toBe(
      "/tree-sitter/parsers/c/parser.wasm",
    );
    expect(resolveLanguageAssetUrl("c", "", "highlights.scm")).toBe(
      "/tree-sitter/parsers/c/highlights.scm",
    );
  });

  it("keeps relative asset paths inside bundled parser folders", () => {
    expect(resolveLanguageAssetUrl("typescript", "parser.wasm", "parser.wasm")).toBe(
      "/tree-sitter/parsers/typescript/parser.wasm",
    );
    expect(resolveLanguageAssetUrl("typescript", "queries/highlights.scm", "highlights.scm")).toBe(
      "/tree-sitter/parsers/typescript/queries/highlights.scm",
    );
  });

  it("preserves absolute URLs and absolute paths", () => {
    expect(
      resolveLanguageAssetUrl("c", "https://cdn.example.com/c/parser.wasm", "parser.wasm"),
    ).toBe("https://cdn.example.com/c/parser.wasm");
    expect(resolveLanguageAssetUrl("c", "/custom/parsers/c/parser.wasm", "parser.wasm")).toBe(
      "/custom/parsers/c/parser.wasm",
    );
  });

  it("uses bundled parser fallbacks for unknown languages", () => {
    expect(getWasmUrlForLanguage("__unknown_lang__")).toBe(
      "/tree-sitter/parsers/__unknown_lang__/parser.wasm",
    );
    expect(getHighlightQueryUrl("__unknown_lang__")).toBe(
      "/tree-sitter/parsers/__unknown_lang__/highlights.scm",
    );
  });
});

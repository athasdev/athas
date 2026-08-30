import { describe, expect, it } from "vite-plus/test";
import {
  getPackagedLanguageExtensions,
  getHighlightQueryUrl,
  getWasmUrlForLanguage,
  resolveLanguageAssetUrl,
} from "@/extensions/languages/language-packager";

describe("language-packager asset URL resolution", () => {
  it("builds the offline catalog from official extension manifests", () => {
    const manifests = getPackagedLanguageExtensions();

    expect(manifests.length).toBeGreaterThan(40);
    expect(manifests.some((manifest) => manifest.id === "athas.rust")).toBe(true);
    expect(manifests.some((manifest) => manifest.id === "athas.html")).toBe(true);
  });

  it("preserves Java language server initialization settings", () => {
    const java = getPackagedLanguageExtensions().find((manifest) => manifest.id === "athas.java");

    expect(java?.lsp?.initializationOptions).toMatchObject({
      settings: {
        java: {
          autobuild: { enabled: true },
          format: { enabled: true },
          import: {
            gradle: { enabled: true, wrapper: { enabled: true } },
            maven: { enabled: true },
          },
          inlayHints: { parameterNames: { enabled: "literals" } },
          signatureHelp: { enabled: true },
        },
      },
    });
  });

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

import { describe, expect, it } from "vite-plus/test";
import { getPackagedLanguageExtensions } from "@/extensions/languages/language-packager";

describe("language packager", () => {
  it("builds the offline catalog from official extension manifests", () => {
    const manifests = getPackagedLanguageExtensions();

    expect(manifests.length).toBeGreaterThan(40);
    expect(manifests.some((manifest) => manifest.id === "athas.rust")).toBe(true);
    expect(manifests.some((manifest) => manifest.id === "athas.html")).toBe(true);
  });

  it("installs language integrations without downloading parsers", () => {
    const rust = getPackagedLanguageExtensions().find((manifest) => manifest.id === "athas.rust");

    expect(rust?.installation).toEqual({ type: "download", minEditorVersion: "0.1.0" });
    expect(rust).not.toHaveProperty("grammar");
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
});

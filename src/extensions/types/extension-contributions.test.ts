import { describe, expect, it } from "vite-plus/test";
import type { ExtensionManifest } from "./extension-manifest";
import {
  getManifestActivationEvents,
  getManifestLanguageContributions,
  matchesLanguageContribution,
} from "./extension-contributions";

function createManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: "athas.test",
    name: "Test",
    displayName: "Test",
    description: "Test extension",
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Language"],
    ...overrides,
  };
}

describe("extension contribution normalization", () => {
  it("reads languages from manifest contributes blocks", () => {
    const manifest = createManifest({
      contributes: {
        languages: [
          {
            id: "jsonc",
            extensions: [],
            filenames: ["tsconfig.json"],
            filenamePatterns: ["tsconfig.*.json"],
          },
        ],
      },
    });

    const languages = getManifestLanguageContributions(manifest);

    expect(languages).toHaveLength(1);
    expect(languages[0].id).toBe("jsonc");
    expect(matchesLanguageContribution("/repo/tsconfig.json", languages[0])).toBe(true);
    expect(matchesLanguageContribution("/repo/tsconfig.app.json", languages[0])).toBe(true);
  });

  it("keeps explicit activation events and otherwise derives language activation events", () => {
    expect(
      getManifestActivationEvents(
        createManifest({
          languages: [{ id: "typescript", extensions: [".ts"] }],
        }),
      ),
    ).toEqual(["onLanguage:typescript"]);

    expect(
      getManifestActivationEvents(
        createManifest({
          activationEvents: ["onCommand:test.run"],
          languages: [{ id: "typescript", extensions: [".ts"] }],
        }),
      ),
    ).toEqual(["onCommand:test.run"]);
  });

  it("matches compound filenames by their final extension", () => {
    expect(
      matchesLanguageContribution("/repo/src/routes/+page.svelte.ts", {
        id: "typescript",
        extensions: [".ts", ".mts", ".cts"],
      }),
    ).toBe(true);

    expect(
      matchesLanguageContribution("/repo/src/routes/+page.svelte.ts", {
        id: "svelte",
        extensions: [".svelte"],
      }),
    ).toBe(false);
  });
});

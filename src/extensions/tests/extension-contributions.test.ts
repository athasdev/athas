import { describe, expect, it } from "vite-plus/test";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import {
  getManifestAIProviderContributions,
  getManifestDatabaseContributions,
  getManifestIconContributions,
  getManifestActivationEvents,
  getManifestLanguageContributions,
  matchesLanguageContribution,
} from "@/extensions/types/extension-contributions";

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

  it("reads database contributions from the new databases field", () => {
    const manifest = createManifest({
      categories: ["Database"],
      databases: [
        {
          id: "duckdb",
          label: "DuckDB",
          isFileBased: true,
          protocolVersion: 1,
          sidecar: { "darwin-arm64": "bin/athas-db-duckdb" },
        },
      ],
    });

    expect(getManifestDatabaseContributions(manifest).map((database) => database.id)).toEqual([
      "duckdb",
    ]);
  });

  it("reads icon contributions from the new icons field", () => {
    const manifest = createManifest({
      categories: ["Icon Theme"],
      contributes: {
        icons: [
          {
            id: "market",
            name: "Market",
            iconDefinitions: {},
          },
        ],
      },
    });

    expect(getManifestIconContributions(manifest).map((icon) => icon.id)).toEqual(["market"]);
  });

  it("reads AI provider contributions", () => {
    const manifest = createManifest({
      categories: ["AI"],
      contributes: {
        aiProviders: [
          {
            id: "v0",
            name: "v0",
            apiUrl: "https://api.v0.dev/v1/chats",
            requiresApiKey: true,
            models: [{ id: "v0-auto", name: "v0 Auto", maxTokens: 50000 }],
          },
        ],
      },
    });

    expect(getManifestAIProviderContributions(manifest).map((provider) => provider.id)).toEqual([
      "v0",
    ]);
  });
});

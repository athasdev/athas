import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AvailableExtension } from "@/extensions/registry/extension-store-types";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

const mocks = vi.hoisted(() => ({
  installLanguage: vi.fn(),
  bundledManifests: new Map<string, unknown>(),
}));

vi.mock("@/extensions/installer/extension-installer", () => ({
  extensionInstaller: { installLanguage: mocks.installLanguage },
}));
vi.mock("@/extensions/languages/language-packager", () => ({
  getWasmUrlForLanguage: (id: string) => `https://cdn.test/${id}/parser.wasm`,
  getHighlightQueryUrl: (id: string) => (id === "python" ? "" : `https://cdn.test/${id}/q.scm`),
  getHighlightQueryUrlForExtension: () => "",
  getLanguageExtensionById: (id: string) => mocks.bundledManifests.get(id),
}));

const { getExtensionManifestForLanguage, installLanguageExtensionManifest } =
  await import("@/extensions/runtime/language-extension-installation");

function manifest(id: string, languageIds: string[]): ExtensionManifest {
  return {
    id,
    name: id,
    displayName: id,
    description: id,
    version: "3.0.0",
    publisher: "Athas",
    categories: ["Language"],
    languages: languageIds.map((languageId) => ({
      id: languageId,
      extensions: [`.${languageId}`],
    })),
    installation: { checksum: "abc123" } as ExtensionManifest["installation"],
  };
}

afterEach(() => {
  mocks.installLanguage.mockReset();
  mocks.bundledManifests.clear();
});

describe("language integration installation", () => {
  it("installs every contributed language with its parser, query, and checksum", async () => {
    mocks.installLanguage.mockResolvedValue(undefined);

    await installLanguageExtensionManifest(
      "athas.web",
      manifest("athas.web", ["css", "python"]),
      () => {},
    );

    expect(mocks.installLanguage).toHaveBeenCalledWith(
      "css",
      "https://cdn.test/css/parser.wasm",
      "https://cdn.test/css/q.scm",
      expect.objectContaining({ extensionId: "athas.web", version: "3.0.0", checksum: "abc123" }),
    );
    expect(mocks.installLanguage).toHaveBeenCalledWith(
      "python",
      "https://cdn.test/python/parser.wasm",
      "https://cdn.test/python/highlights.scm",
      expect.anything(),
    );
  });

  it("reports progress as the average across languages", async () => {
    const progressCallbacks: Array<(progress: { percentage: number }) => void> = [];
    mocks.installLanguage.mockImplementation(async (_id, _wasm, _query, options) => {
      progressCallbacks.push(options.onProgress);
    });
    const onProgress = vi.fn();

    await installLanguageExtensionManifest(
      "athas.web",
      manifest("athas.web", ["css", "html"]),
      onProgress,
    );
    progressCallbacks[0]?.({ percentage: 50 });
    progressCallbacks[1]?.({ percentage: 100 });
    progressCallbacks[0]?.({ percentage: 100 });

    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([25, 75, 100]);
  });

  it("fails the install when any language fails", async () => {
    mocks.installLanguage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("checksum mismatch"));

    await expect(
      installLanguageExtensionManifest(
        "athas.web",
        manifest("athas.web", ["css", "html"]),
        () => {},
      ),
    ).rejects.toThrow("checksum mismatch");
  });

  it("finds a language manifest from the catalog before the bundled packager", () => {
    const catalogManifest = manifest("athas.go", ["go"]);
    const bundled = manifest("bundled.go", ["go"]);
    mocks.bundledManifests.set("go", bundled);
    const available = new Map<string, AvailableExtension>([
      [
        "athas.go",
        { manifest: catalogManifest, isInstalled: false, isEnabled: true, isInstalling: false },
      ],
    ]);

    expect(getExtensionManifestForLanguage("athas.go", available, "go")).toBe(catalogManifest);
    expect(getExtensionManifestForLanguage("other.go", available, "go")).toBe(bundled);
  });
});

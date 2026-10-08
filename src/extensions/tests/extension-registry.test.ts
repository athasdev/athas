import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionManifest } from "../types/extension-manifest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: mocks.invoke,
}));

async function createRegistry() {
  vi.resetModules();
  const { extensionRegistry } = await import("../registry/extension-registry");
  await extensionRegistry.ensureInitialized();
  return extensionRegistry;
}

function createManifest(overrides: Partial<ExtensionManifest> & { id: string }): ExtensionManifest {
  return {
    name: overrides.id,
    displayName: overrides.id,
    description: "Test integration",
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Language"],
    ...overrides,
  };
}

const rustManifest = createManifest({
  id: "test.rust",
  languages: [{ id: "rust", extensions: [".rs"], aliases: ["Rust"] }],
});

const rustLsp = { fileExtensions: [".rs"], languageIds: ["rust"] };

const webManifest = createManifest({
  id: "test.web",
  languages: [
    { id: "javascript", extensions: [".js", ".mjs"] },
    { id: "json", extensions: [".json"], filenames: [".babelrc"] },
  ],
});

beforeEach(() => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_bundled_extensions_path") return "/opt/athas/bundled";
    throw new Error(`Unexpected command ${command}`);
  });
});

afterEach(() => {
  mocks.invoke.mockReset();
});

describe("extension registry bundled extensions", () => {
  it("registers bundled extensions under the backend bundled path", async () => {
    const registry = await createRegistry();

    const pierre = registry.getExtension("athas.icon-theme.pierre");
    expect(pierre).toMatchObject({
      path: "/opt/athas/bundled/icon-themes/pierre",
      isBundled: true,
      isEnabled: true,
      state: "installed",
    });
  });

  it("falls back to the relative bundled path when the backend cannot resolve it", async () => {
    mocks.invoke.mockRejectedValue(new Error("command unavailable"));

    const registry = await createRegistry();

    expect(registry.getExtension("athas.icon-theme.pierre")?.path).toBe(
      "./extensions/bundled/icon-themes/pierre",
    );
  });
});

describe("extension registry runtime registration", () => {
  it("defaults new registrations to an enabled, installed, non-bundled extension", async () => {
    const registry = await createRegistry();

    registry.registerExtension(rustManifest);

    expect(registry.getExtension("test.rust")).toEqual({
      manifest: rustManifest,
      path: "",
      isBundled: false,
      isEnabled: true,
      state: "installed",
    });
  });

  it("keeps existing registration details that a re-registration does not override", async () => {
    const registry = await createRegistry();
    registry.registerExtension(rustManifest, {
      path: "/extensions/rust",
      isBundled: true,
      isEnabled: false,
      state: "deactivated",
    });

    const updatedManifest = { ...rustManifest, version: "2.0.0" };
    registry.registerExtension(updatedManifest);

    expect(registry.getExtension("test.rust")).toEqual({
      manifest: updatedManifest,
      path: "/extensions/rust",
      isBundled: true,
      isEnabled: false,
      state: "deactivated",
    });

    registry.registerExtension(updatedManifest, { isEnabled: true, state: "installed" });
    expect(registry.getExtension("test.rust")).toMatchObject({
      path: "/extensions/rust",
      isEnabled: true,
      state: "installed",
    });
  });

  it("tracks activation state and forgets it when an extension is unregistered", async () => {
    const registry = await createRegistry();
    registry.registerExtension(rustManifest);
    registry.registerExtension(webManifest);

    registry.setExtensionState("test.rust", "activated");
    registry.setExtensionState("test.web", "activated");
    expect(registry.isExtensionActivated("test.rust")).toBe(true);
    expect(registry.getActivatedExtensions().map((ext) => ext.manifest.id)).toEqual([
      "test.rust",
      "test.web",
    ]);

    registry.setExtensionState("test.web", "deactivated");
    expect(registry.getExtension("test.web")?.state).toBe("deactivated");
    expect(registry.isExtensionActivated("test.web")).toBe(false);

    registry.unregisterExtension("test.rust");
    expect(registry.getExtension("test.rust")).toBeUndefined();
    expect(registry.isExtensionActivated("test.rust")).toBe(false);
    expect(registry.getActivatedExtensions()).toEqual([]);
  });

  it("keeps activation tracking when moving to an intermediate state", async () => {
    const registry = await createRegistry();
    registry.registerExtension(rustManifest);

    registry.setExtensionState("test.rust", "activated");
    registry.setExtensionState("test.rust", "error");

    expect(registry.getExtension("test.rust")?.state).toBe("error");
    expect(registry.isExtensionActivated("test.rust")).toBe(true);
  });

  it("ignores state changes for unknown extensions", async () => {
    const registry = await createRegistry();

    registry.setExtensionState("test.missing", "activated");

    expect(registry.isExtensionActivated("test.missing")).toBe(false);
    expect(registry.getExtension("test.missing")).toBeUndefined();
  });
});

describe("extension registry language lookup", () => {
  it("finds extensions by language id, file extension, and file name", async () => {
    const registry = await createRegistry();
    registry.registerExtension(rustManifest);
    registry.registerExtension(webManifest);

    expect(registry.getExtensionByLanguageId("json")?.manifest.id).toBe("test.web");
    expect(registry.getExtensionByLanguageId("cobol")).toBeUndefined();

    expect(registry.getExtensionByFileExtension(".rs")?.manifest.id).toBe("test.rust");
    expect(registry.getExtensionByFileExtension("mjs")?.manifest.id).toBe("test.web");
    expect(registry.getExtensionByFileExtension(".cob")).toBeUndefined();

    expect(registry.getExtensionForFilePath("/repo/src/main.rs")?.manifest.id).toBe("test.rust");
    expect(registry.getExtensionForFilePath("C:\\repo\\.babelrc")?.manifest.id).toBe("test.web");
    expect(registry.getExtensionForFilePath("/repo/README")).toBeUndefined();
  });

  it("resolves the matching language within a multi-language extension", async () => {
    const registry = await createRegistry();
    registry.registerExtension(webManifest);

    expect(registry.getLanguageId("/repo/package.json")).toBe("json");
    expect(registry.getLanguageId("/repo/.babelrc")).toBe("json");
    expect(registry.getLanguageId("/repo/index.mjs")).toBe("javascript");
    expect(registry.getLanguageId("/repo/notes.txt")).toBeNull();
  });

  it("reports the deduplicated set of supported languages and file extensions", async () => {
    const registry = await createRegistry();
    registry.registerExtension(webManifest);
    registry.registerExtension(
      createManifest({
        id: "test.web-extra",
        languages: [{ id: "javascript", extensions: [".js", ".cjs"] }],
      }),
    );

    expect(registry.getSupportedLanguageIds().sort()).toEqual(["javascript", "json"]);
    expect(registry.getSupportedFileExtensions().sort()).toEqual([".cjs", ".js", ".json", ".mjs"]);
  });
});

describe("extension registry language server resolution", () => {
  it("prefers the platform-specific server and resolves relative paths inside the extension", async () => {
    const registry = await createRegistry();
    registry.registerExtension(
      createManifest({
        ...rustManifest,
        lsp: {
          ...rustLsp,
          server: {
            [registry.getPlatform()]: "./bin/rust-analyzer",
            default: "/usr/bin/rust-analyzer",
          },
          args: ["--stdio"],
          initializationOptions: { checkOnSave: true },
        },
      }),
      { path: "/extensions/rust" },
    );

    expect(registry.isLspSupported("/repo/main.rs")).toBe(true);
    expect(registry.getLspServerPath("/repo/main.rs")).toBe("/extensions/rust/bin/rust-analyzer");
    expect(registry.getLspServerArgs("/repo/main.rs")).toEqual(["--stdio"]);
    expect(registry.getLspInitializationOptions("/repo/main.rs")).toEqual({ checkOnSave: true });
  });

  it("falls back to the default server and leaves absolute paths untouched", async () => {
    const registry = await createRegistry();
    registry.registerExtension(
      createManifest({
        ...rustManifest,
        lsp: { ...rustLsp, server: { default: "/usr/bin/rust-analyzer" } },
      }),
      { path: "/extensions/rust" },
    );

    expect(registry.getLspServerPath("/repo/main.rs")).toBe("/usr/bin/rust-analyzer");
    expect(registry.getLspServerArgs("/repo/main.rs")).toEqual([]);
    expect(registry.getLspInitializationOptions("/repo/main.rs")).toBeUndefined();
  });

  it("returns no server when the extension has none for this platform", async () => {
    const registry = await createRegistry();
    const otherPlatform = registry.getPlatform() === "win32" ? "linux" : "win32";
    registry.registerExtension(
      createManifest({
        ...rustManifest,
        lsp: { ...rustLsp, server: { [otherPlatform]: "/other/rust-analyzer" } },
      }),
    );

    expect(registry.isLspSupported("/repo/main.rs")).toBe(true);
    expect(registry.getLspServerPath("/repo/main.rs")).toBeNull();
  });

  it("returns empty language server details for files without language server support", async () => {
    const registry = await createRegistry();
    registry.registerExtension(webManifest);

    expect(registry.isLspSupported("/repo/index.js")).toBe(false);
    expect(registry.getLspServerPath("/repo/index.js")).toBeNull();
    expect(registry.getLspServerArgs("/repo/index.js")).toEqual([]);
    expect(registry.getLspInitializationOptions("/repo/index.js")).toBeUndefined();
    expect(registry.isLspSupported("/repo/unknown.xyz")).toBe(false);
  });
});

describe("extension registry formatter and linter resolution", () => {
  it("resolves formatter commands by file and by language", async () => {
    const registry = await createRegistry();
    registry.registerExtension(
      createManifest({
        ...rustManifest,
        formatter: {
          name: "rustfmt",
          command: { default: "./bin/rustfmt" },
          args: ["--emit", "stdout"],
          env: { RUST_LOG: "warn" },
          languages: ["rust"],
          inputMethod: "stdin",
          outputMethod: "stdout",
        },
      }),
      { path: "/extensions/rust" },
    );

    const expected = {
      name: "rustfmt",
      command: "/extensions/rust/bin/rustfmt",
      args: ["--emit", "stdout"],
      env: { RUST_LOG: "warn" },
      inputMethod: "stdin",
      outputMethod: "stdout",
    };
    expect(registry.getFormatterForFile("/repo/main.rs")).toEqual(expected);
    expect(registry.getFormatterForLanguage("rust")).toEqual(expected);
  });

  it("applies formatter defaults and keeps absolute commands", async () => {
    const registry = await createRegistry();
    registry.registerExtension(
      createManifest({
        ...webManifest,
        formatter: { command: { default: "/usr/bin/fmt" }, languages: ["javascript"] },
      }),
      { path: "/extensions/web" },
    );

    expect(registry.getFormatterForLanguage("javascript")).toMatchObject({
      name: "prettier",
      command: "/usr/bin/fmt",
      args: [],
    });
  });

  it("returns no formatter when none is configured or none matches this platform", async () => {
    const registry = await createRegistry();
    const otherPlatform = registry.getPlatform() === "win32" ? "linux" : "win32";
    registry.registerExtension(rustManifest);
    registry.registerExtension(
      createManifest({
        ...webManifest,
        formatter: { command: { [otherPlatform]: "fmt.exe" }, languages: ["javascript"] },
      }),
    );

    expect(registry.getFormatterForFile("/repo/main.rs")).toBeNull();
    expect(registry.getFormatterForLanguage("rust")).toBeNull();
    expect(registry.getFormatterForFile("/repo/index.js")).toBeNull();
    expect(registry.getFormatterForLanguage("javascript")).toBeNull();
    expect(registry.getFormatterForLanguage("cobol")).toBeNull();
  });

  it("resolves linter commands by file and by language", async () => {
    const registry = await createRegistry();
    registry.registerExtension(
      createManifest({
        ...webManifest,
        linter: {
          command: { [registry.getPlatform()]: "./bin/eslint", default: "/usr/bin/eslint" },
          env: { NODE_ENV: "test" },
          languages: ["javascript"],
          inputMethod: "file",
          diagnosticFormat: "regex",
          diagnosticPattern: "^(.*):(\\d+)$",
        },
      }),
      { path: "/extensions/web" },
    );

    const expected = {
      command: "/extensions/web/bin/eslint",
      args: [],
      env: { NODE_ENV: "test" },
      inputMethod: "file",
      diagnosticFormat: "regex",
      diagnosticPattern: "^(.*):(\\d+)$",
    };
    expect(registry.getLinterForFile("/repo/index.js")).toEqual(expected);
    expect(registry.getLinterForLanguage("javascript")).toEqual(expected);
  });

  it("keeps absolute linter commands and reports no linter when unavailable", async () => {
    const registry = await createRegistry();
    const otherPlatform = registry.getPlatform() === "win32" ? "linux" : "win32";
    registry.registerExtension(
      createManifest({
        ...webManifest,
        linter: { command: { default: "/usr/bin/eslint" }, args: ["--fix"], languages: [] },
      }),
    );
    registry.registerExtension(
      createManifest({
        ...rustManifest,
        linter: { command: { [otherPlatform]: "clippy.exe" }, languages: ["rust"] },
      }),
    );

    expect(registry.getLinterForLanguage("javascript")).toMatchObject({
      command: "/usr/bin/eslint",
      args: ["--fix"],
    });
    expect(registry.getLinterForFile("/repo/main.rs")).toBeNull();
    expect(registry.getLinterForLanguage("rust")).toBeNull();
    expect(registry.getLinterForFile("/repo/notes.txt")).toBeNull();
    expect(registry.getLinterForLanguage("cobol")).toBeNull();
  });
});

describe("extension registry snippets", () => {
  it("collects snippets per language across every registered extension", async () => {
    const registry = await createRegistry();
    registry.registerExtension(
      createManifest({
        ...rustManifest,
        snippets: [
          {
            language: "rust",
            snippets: [{ prefix: "fn", body: ["fn ${1:name}() {}"], description: "Function" }],
          },
        ],
      }),
    );
    registry.registerExtension(
      createManifest({
        id: "test.rust-snippets",
        contributes: {
          snippets: [
            { language: "rust", snippets: [{ prefix: "test", body: "#[test]" }] },
            { language: "toml", snippets: [{ prefix: "dep", body: 'dep = "1"' }] },
          ],
        },
      }),
    );

    expect(registry.getSnippetsForLanguage("rust")).toEqual([
      { prefix: "fn", body: ["fn ${1:name}() {}"], description: "Function" },
      { prefix: "test", body: "#[test]" },
    ]);
    expect(registry.getSnippetsForLanguage("python")).toEqual([]);
    expect(registry.getAllSnippets().filter((snippet) => snippet.language === "toml")).toEqual([
      { language: "toml", prefix: "dep", body: 'dep = "1"' },
    ]);
  });
});

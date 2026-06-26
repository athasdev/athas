import { describe, expect, it } from "vite-plus/test";
import type { ExtensionManifest } from "../types/extension-manifest";
import {
  buildRuntimeManifest,
  getLanguageToolConfigSet,
  isExpectedMissingToolError,
  resolveToolDownloadUrlForBackend,
  resolveToolCommandForManifest,
  resolveToolDownloadUrlForManifest,
} from "./extension-store-runtime";

function createManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: "athas.test",
    name: "Test",
    displayName: "Test",
    description: "Test language support",
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Language"],
    languages: [
      {
        id: "test",
        extensions: [".test"],
      },
    ],
    ...overrides,
  };
}

describe("extension-store runtime manifest", () => {
  it("uses the known working Marksman release asset instead of stale extension package URLs", () => {
    const url = resolveToolDownloadUrlForManifest(
      {
        name: "marksman",
        downloadUrl: "https://athas.dev/extensions/markdown/markdown-${os}-${arch}.tar.gz",
      },
      "1.0.0",
    );

    expect(url).toMatch(
      /^https:\/\/github\.com\/artempyanykh\/marksman\/releases\/latest\/download\/(marksman-macos|marksman\.exe|marksman-linux-(arm64|x64))$/,
    );
  });

  it("uses the known Lua language server release asset instead of stale package URLs", () => {
    const url = resolveToolDownloadUrlForManifest(
      {
        name: "lua-language-server",
        downloadUrl: "https://athas.dev/extensions/packages/lua/lua-${os}-${arch}.tar.gz",
      },
      "1.0.0",
    );

    expect(url).toContain("https://github.com/LuaLS/lua-language-server/releases/download/3.18.2/");
    expect(url).toMatch(
      /lua-language-server-3\.18\.2-((darwin|linux)-(arm64|x64)\.tar\.gz|win32-x64\.zip)$/,
    );
  });

  it("uses the known StyLua release asset for Lua formatting", () => {
    const url = resolveToolDownloadUrlForManifest(
      {
        name: "stylua",
      },
      "1.0.0",
    );

    expect(url).toMatch(
      /^https:\/\/github\.com\/JohnnyMorganz\/StyLua\/releases\/latest\/download\/stylua-(macos|linux|windows)-(aarch64|x86_64)(-musl)?\.zip$/,
    );
  });

  it("uses the known Zig SDK asset for Zig formatting", () => {
    const url = resolveToolDownloadUrlForManifest(
      {
        name: "zig",
      },
      "1.0.0",
    );

    expect(url).toMatch(
      /^https:\/\/ziglang\.org\/download\/0\.16\.0\/zig-(aarch64|x86_64)-(macos|linux|windows)-0\.16\.0\.(tar\.xz|zip)$/,
    );
  });

  it("uses the pyright language server executable for the pyright package", () => {
    expect(resolveToolCommandForManifest({ name: "pyright" })).toBe("pyright-langserver");
  });

  it("defers generic platform URL templates to the Rust backend for libc-aware resolution", () => {
    const template =
      "https://athas.dev/extensions/test/test-${targetArch}-${targetOs}.${archiveExt}";

    expect(
      resolveToolDownloadUrlForBackend(
        {
          name: "test-language-server",
          downloadUrl: template,
        },
        "1.0.0",
      ),
    ).toBe(template);
  });

  it("strips unresolved managed tools from the runtime manifest", () => {
    const manifest = createManifest({
      lsp: {
        name: "marksman",
        runtime: "binary",
        downloadUrl: "https://athas.dev/extensions/markdown/markdown-${os}-${arch}.tar.gz",
        server: { default: "marksman" },
        args: ["server"],
        fileExtensions: [".md"],
        languageIds: ["markdown"],
      },
      formatter: {
        name: "prettier",
        runtime: "bun",
        package: "prettier",
        command: { default: "prettier" },
        args: ["--stdin-filepath", "${file}"],
        languages: ["markdown"],
      },
      linter: {
        name: "eslint",
        runtime: "bun",
        package: "eslint",
        command: { default: "eslint" },
        args: ["--format", "json"],
        languages: ["markdown"],
      },
    });

    const runtimeManifest = buildRuntimeManifest(manifest, {});

    expect(runtimeManifest.lsp).toBeUndefined();
    expect(runtimeManifest.formatter).toBeUndefined();
    expect(runtimeManifest.linter).toBeUndefined();
  });

  it("keeps bundled tool paths that are not managed by the language tool installer", () => {
    const manifest = createManifest({
      lsp: {
        server: {
          darwin: "lsp/test-language-server",
          linux: "lsp/test-language-server",
          win32: "lsp/test-language-server.exe",
        },
        args: ["--stdio"],
        fileExtensions: [".test"],
        languageIds: ["test"],
      },
    });

    const runtimeManifest = buildRuntimeManifest(manifest, {});

    expect(runtimeManifest.lsp?.server.darwin).toBe("lsp/test-language-server");
  });

  it("rewrites managed tool commands to resolved paths", () => {
    const manifest = createManifest({
      lsp: {
        name: "marksman",
        runtime: "binary",
        server: { default: "marksman" },
        args: ["server"],
        fileExtensions: [".md"],
        languageIds: ["markdown"],
      },
    });

    const runtimeManifest = buildRuntimeManifest(manifest, {
      lsp: "/tmp/athas-tools/bin/marksman",
    });

    expect(runtimeManifest.lsp?.server.default).toBe("/tmp/athas-tools/bin/marksman");
  });

  it("preserves companion packages when rewriting managed LSP commands", () => {
    const manifest = createManifest({
      lsp: {
        name: "vtsls",
        runtime: "bun",
        package: "@vtsls/language-server",
        packages: ["typescript"],
        server: { default: "vtsls" },
        args: ["--stdio"],
        fileExtensions: [".js"],
        languageIds: ["javascript"],
      },
    });

    const runtimeManifest = buildRuntimeManifest(manifest, {
      lsp: "/tmp/athas-tools/bun/@vtsls/language-server/node_modules/@vtsls/language-server/bin/vtsls.js",
    });

    expect(runtimeManifest.lsp?.server.default).toContain("vtsls.js");
    expect(runtimeManifest.lsp?.packages).toEqual(["typescript"]);
  });

  it("passes R language server tools to the backend", () => {
    const manifest = createManifest({
      lsp: {
        name: "r-languageserver",
        runtime: "r",
        package: "languageserver",
        server: { default: "r-languageserver" },
        args: [],
        fileExtensions: [".R", ".r"],
        languageIds: ["r"],
      },
    });

    expect(getLanguageToolConfigSet(manifest)?.lsp).toMatchObject({
      name: "r-languageserver",
      runtime: "r",
      package: "languageserver",
    });
  });

  it("treats missing system tools as expected optional-tool resolution failures", () => {
    expect(
      isExpectedMissingToolError(
        "Tool 'metals (system tool not found in PATH or known toolchain locations)' not found",
      ),
    ).toBe(true);
    expect(isExpectedMissingToolError("permission denied")).toBe(false);
  });

  it("passes system toolchain tools to the backend without download metadata", () => {
    const manifest = createManifest({
      lsp: {
        name: "sourcekit-lsp",
        runtime: "system",
        server: { default: "sourcekit-lsp" },
        args: [],
        fileExtensions: [".swift"],
        languageIds: ["swift"],
      },
    });

    expect(getLanguageToolConfigSet(manifest)?.lsp).toMatchObject({
      name: "sourcekit-lsp",
      runtime: "system",
    });
    expect(getLanguageToolConfigSet(manifest)?.lsp?.downloadUrl).toBeUndefined();
  });
});

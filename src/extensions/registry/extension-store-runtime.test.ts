import { describe, expect, it } from "vite-plus/test";
import type { ExtensionManifest } from "../types/extension-manifest";
import {
  buildRuntimeManifest,
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
});

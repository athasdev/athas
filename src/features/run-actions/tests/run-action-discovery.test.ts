import { describe, expect, test } from "vite-plus/test";
import {
  codeLensesToRunActions,
  discoverProjectRunActions,
  isRunnableCodeLens,
  parseCargoRunActions,
  parseJustfileRunActions,
  parseMakefileRunActions,
  parsePackageRunActions,
  parsePyprojectRunActions,
  resolveRunWorkingDirectory,
} from "../utils/run-action-discovery";

describe("run action discovery", () => {
  test("discovers package scripts with the declared package manager and useful ordering", () => {
    const actions = parsePackageRunActions(
      JSON.stringify({
        packageManager: "pnpm@10.0.0",
        scripts: {
          build: "vite build",
          dev: "vite",
          "test:unit": "vitest",
          lint: "eslint .",
        },
      }),
      "/repo",
    );

    expect(actions.map((action) => action.name)).toEqual(["dev", "lint", "build", "test:unit"]);
    expect(actions.map((action) => action.command)).toEqual([
      "pnpm run dev",
      "pnpm run lint",
      "pnpm run build",
      "pnpm run test:unit",
    ]);
    expect(actions[0]?.description).toBe("vite");
  });

  test("uses lockfiles when packageManager is not declared", () => {
    const actions = parsePackageRunActions(
      JSON.stringify({ scripts: { dev: "next dev" } }),
      "/repo",
      new Set(["package.json", "bun.lock"]),
    );

    expect(actions[0]?.command).toBe("bun run dev");
  });

  test("returns no actions for malformed package metadata", () => {
    expect(parsePackageRunActions("{", "/repo")).toEqual([]);
    expect(parsePackageRunActions(JSON.stringify({ scripts: { dev: false } }), "/repo")).toEqual(
      [],
    );
  });

  test("discovers Cargo, Make, just, and Python entry points", () => {
    expect(
      parseCargoRunActions('[package]\nname = "demo"', "/repo").map((item) => item.command),
    ).toEqual(["cargo run", "cargo test", "cargo check", "cargo build"]);

    expect(
      parseMakefileRunActions(
        [".PHONY: dev", "dev:", "\tvite", "test-unit:", "\tvitest", "_internal:"].join("\n"),
        "/repo",
      ).map((item) => item.command),
    ).toEqual(["make dev", "make test-unit"]);

    expect(
      parseJustfileRunActions(
        ["# recipes", "dev:", "  bun run dev", "check target:"].join("\n"),
        "/repo",
      ).map((item) => item.command),
    ).toEqual(["just dev", "just check"]);

    expect(
      parsePyprojectRunActions(
        [
          "[project.scripts]",
          'athas = "athas.cli:main"',
          "",
          "[tool.pytest.ini_options]",
          'testpaths = ["tests"]',
        ].join("\n"),
        "/repo",
      ).map((item) => item.command),
    ).toEqual(["athas", "pytest"]);
  });

  test("keeps only runnable LSP CodeLens commands and preserves their source location", () => {
    const lenses = [
      { line: 3, title: "Run test", command: "rust-analyzer.runSingle" },
      { line: 8, title: "References", command: "editor.showReferences" },
      { line: 12, title: "Debug benchmark", command: "rust-analyzer.debugSingle" },
      { line: 14, title: "Run" },
    ];

    expect(lenses.map(isRunnableCodeLens)).toEqual([true, false, true, false]);
    expect(codeLensesToRunActions(lenses, "/repo/src/lib.rs")).toMatchObject([
      {
        name: "Run test",
        description: "lib.rs:4",
        source: "lsp",
      },
      {
        name: "Debug benchmark",
        description: "lib.rs:13",
        source: "lsp",
      },
    ]);
  });

  test("resolves custom working directories against local and remote project roots", () => {
    expect(resolveRunWorkingDirectory("/repo", undefined)).toBe("/repo");
    expect(resolveRunWorkingDirectory("/repo", ".")).toBe("/repo");
    expect(resolveRunWorkingDirectory("/repo", "apps/web")).toBe("/repo/apps/web");
    expect(resolveRunWorkingDirectory("/repo", "/tmp/build")).toBe("/tmp/build");
    expect(resolveRunWorkingDirectory("remote://server/workspace", "apps/api")).toBe(
      "remote://server/workspace/apps/api",
    );
  });

  test("scans available manifests together and ignores missing files", async () => {
    const files = new Map([
      [
        "/repo/package.json",
        JSON.stringify({
          packageManager: "bun@1.3.0",
          scripts: { dev: "vite", test: "vitest" },
        }),
      ],
      ["/repo/Cargo.toml", '[workspace]\nmembers = ["native"]'],
      ["/repo/justfile", "release:\n  cargo build --release"],
    ]);

    const actions = await discoverProjectRunActions("/repo", async (path) => {
      const content = files.get(path);
      if (content == null) throw new Error("missing");
      return content;
    });

    expect(actions.map((action) => action.command)).toEqual([
      "bun run dev",
      "bun run test",
      "cargo test",
      "cargo check",
      "cargo build",
      "just release",
    ]);
  });
});

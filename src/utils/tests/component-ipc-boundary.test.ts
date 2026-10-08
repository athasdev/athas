import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const srcRoot = new URL("../../", import.meta.url);

const COMPONENT_ROOTS = ["features/", "extensions/"];

const PENDING_MIGRATION = new Set<string>();

function isIpcSpecifier(specifier: string): boolean {
  return (
    specifier === "@/bindings/commands" ||
    specifier === "@tauri-apps/api/core" ||
    specifier.startsWith("@tauri-apps/plugin-")
  );
}

function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ")) return true;
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;

  const specifiers = trimmed
    .slice(1, -1)
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean);
  return specifiers.length > 0 && specifiers.every((specifier) => specifier.startsWith("type "));
}

function findIpcValueImports(source: string): string[] {
  const violations: string[] = [];

  for (const [, clause, specifier] of source.matchAll(
    /\b(?:import|export)\s+([^'";]*?)\s+from\s+["']([^"']+)["']/g,
  )) {
    if (isIpcSpecifier(specifier) && !isTypeOnlyClause(clause)) violations.push(specifier);
  }

  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (isIpcSpecifier(specifier)) violations.push(specifier);
  }

  for (const [, specifier] of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    if (isIpcSpecifier(specifier)) violations.push(specifier);
  }

  return violations;
}

function collectComponentFiles(directory: URL, insideComponents: boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (entry.name === "tests") return [];
      return collectComponentFiles(
        new URL(`${entry.name}/`, directory),
        insideComponents || entry.name === "components",
      );
    }

    if (!insideComponents || !entry.name.endsWith(".tsx") || entry.name.includes(".test.")) {
      return [];
    }

    return [new URL(entry.name, directory).pathname.slice(srcRoot.pathname.length)];
  });
}

const componentFiles = COMPONENT_ROOTS.flatMap((root) =>
  collectComponentFiles(new URL(root, srcRoot), false),
);

describe("component IPC boundary", () => {
  it("scans the component tree", () => {
    expect(componentFiles.length).toBeGreaterThan(200);
  });

  it("keeps Tauri commands and plugins out of components", () => {
    const violations = componentFiles
      .filter((file) => !PENDING_MIGRATION.has(file))
      .flatMap((file) =>
        findIpcValueImports(readFileSync(new URL(file, srcRoot), "utf8")).map(
          (specifier) => `${file} imports ${specifier}`,
        ),
      );

    expect(violations).toEqual([]);
  });

  it("drops allow-list entries once a component is migrated", () => {
    const stale = [...PENDING_MIGRATION].filter(
      (file) =>
        !componentFiles.includes(file) ||
        findIpcValueImports(readFileSync(new URL(file, srcRoot), "utf8")).length === 0,
    );

    expect(stale).toEqual([]);
  });

  it("allows type-only imports and flags value imports", () => {
    expect(
      findIpcValueImports(
        [
          'import type { Commit } from "@/bindings/commands";',
          'import { type Channel } from "@tauri-apps/api/core";',
          'import { listen } from "@tauri-apps/api/event";',
        ].join("\n"),
      ),
    ).toEqual([]);

    expect(
      findIpcValueImports(
        [
          'import { commands } from "@/bindings/commands";',
          'import { commands, type Commit } from "@/bindings/commands";',
          'import { open } from "@tauri-apps/plugin-dialog";',
          'import { invoke } from "@tauri-apps/api/core";',
          'const { openUrl } = await import("@tauri-apps/plugin-opener");',
        ].join("\n"),
      ),
    ).toEqual([
      "@/bindings/commands",
      "@/bindings/commands",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/api/core",
      "@tauri-apps/plugin-opener",
    ]);
  });
});

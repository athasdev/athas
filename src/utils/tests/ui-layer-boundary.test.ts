import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const srcRoot = new URL("../../", import.meta.url);

function isFeatureLayerSpecifier(specifier: string): boolean {
  return specifier.startsWith("@/features/") || specifier.startsWith("@/extensions/");
}

function toAliasSpecifier(specifier: string, file: string): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;
  const resolved = new URL(specifier, new URL(file, srcRoot)).pathname;
  return resolved.startsWith(srcRoot.pathname)
    ? `@/${resolved.slice(srcRoot.pathname.length)}`
    : specifier;
}

function findFeatureLayerImports(source: string, file = "ui/primitive.tsx"): string[] {
  const specifiers = [
    ...source.matchAll(/\b(?:import|export)\s[^'";]*?\sfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...source.matchAll(/\bvi\.(?:mock|doMock|importActual)\s*(?:<[^>]*>)?\(\s*["']([^"']+)["']/g),
  ].map(([, specifier]) => toAliasSpecifier(specifier, file));

  return specifiers.filter(isFeatureLayerSpecifier);
}

function collectSourceFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return collectSourceFiles(new URL(`${entry.name}/`, directory));
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [new URL(entry.name, directory).pathname.slice(srcRoot.pathname.length)];
  });
}

const uiFiles = collectSourceFiles(new URL("ui/", srcRoot));

describe("ui layer boundary", () => {
  it("scans the ui primitives", () => {
    expect(uiFiles.length).toBeGreaterThan(50);
  });

  it("keeps src/ui free of feature and extension imports", () => {
    const violations = uiFiles.flatMap((file) =>
      findFeatureLayerImports(readFileSync(new URL(file, srcRoot), "utf8"), file).map(
        (specifier) => `${file} imports ${specifier}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it("flags static, type, dynamic, side-effect and relative feature imports", () => {
    expect(
      findFeatureLayerImports(
        [
          'import { cn } from "@/utils/cn";',
          'import Tooltip from "@/ui/tooltip";',
          'import { Kbd } from "./kbd";',
        ].join("\n"),
      ),
    ).toEqual([]);

    expect(
      findFeatureLayerImports(
        [
          'import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";',
          'import type { Theme } from "@/extensions/themes/types";',
          'export { logger } from "@/features/settings/stores/settings.store";',
          'const module = await import("@/features/editor/stores/buffer.store");',
          'import "@/extensions/themes/theme.css";',
          'import { formatKeybinding } from "../features/keymaps/utils/format";',
        ].join("\n"),
      ),
    ).toEqual([
      "@/features/keymaps/hooks/use-command-shortcut",
      "@/extensions/themes/types",
      "@/features/settings/stores/settings.store",
      "@/features/keymaps/utils/format",
      "@/features/editor/stores/buffer.store",
      "@/extensions/themes/theme.css",
    ]);
  });
});

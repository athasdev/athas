import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const themeStyles = readFileSync(new URL("../../../styles/theme.css", import.meta.url), "utf8");
const baseStyles = readFileSync(new URL("../../../styles/base.css", import.meta.url), "utf8");
const utilityStyles = readFileSync(
  new URL("../../../styles/utilities.css", import.meta.url),
  "utf8",
);

function collectSourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);

    if (entry.isDirectory()) return collectSourceFiles(url);
    if (!/\.(?:css|ts|tsx)$/.test(entry.name)) return [];

    return [url];
  });
}

describe("UI typography contract", () => {
  it("derives every interface text tier from the configured UI font size", () => {
    expect(themeStyles).toContain("--ui-text-base: var(--app-ui-font-size);");
    expect(themeStyles).toContain("--ui-text-sm: var(--app-ui-font-size);");
    expect(themeStyles).toContain("--ui-text-caption: var(--ui-text-sm);");
    expect(themeStyles).toContain("--ui-text-chrome: var(--ui-text-sm);");
  });

  it("uses the configured UI font size for inherited interface text", () => {
    expect(baseStyles).toMatch(/body\s*\{[^}]*font-size:\s*var\(--ui-text-base\);/s);
  });

  it("only uses UI text utilities that exist in the design system", () => {
    const definedUtilities = new Set(
      Array.from(utilityStyles.matchAll(/\.((?:ui-text)-[a-z0-9-]+)\s*\{/g), (match) => match[1]),
    );
    const missingUtilities = collectSourceFiles(new URL("../../..", import.meta.url)).flatMap(
      (file) => {
        const source = readFileSync(file, "utf8");
        return Array.from(source.matchAll(/\bui-text-[a-z0-9-]+\b/g), (match) => match[0]).filter(
          (className) => !definedUtilities.has(className),
        );
      },
    );

    expect([...new Set(missingUtilities)]).toEqual([]);
  });

  it("keeps reusable UI primitives on semantic text utilities", () => {
    const primitiveSources = collectSourceFiles(new URL("../../../ui/", import.meta.url))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(primitiveSources).not.toMatch(
      /(?:^|[^a-zA-Z0-9_-])text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[0-9.]+(?:px|rem)\])\b/,
    );
  });
});

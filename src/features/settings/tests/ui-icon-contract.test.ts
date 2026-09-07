import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { ICON_CONCEPTS } from "@/ui/icon-concepts";

const srcRoot = new URL("../../../", import.meta.url);
const iconsSource = readFileSync(new URL("ui/icons.tsx", srcRoot), "utf8");
const iconStyles = readFileSync(new URL("styles/icons.css", srcRoot), "utf8");
const brandSource = readFileSync(new URL("ui/brand-marks.tsx", srcRoot), "utf8");

function collectSourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);

    if (entry.isDirectory()) return collectSourceFiles(url);
    if (!/\.tsx?$/.test(entry.name)) return [];

    return [url];
  });
}

const sourceFiles = collectSourceFiles(srcRoot).filter(
  (url) => !url.pathname.endsWith("ui-icon-contract.test.ts"),
);

const iconExports = [
  ...iconsSource.matchAll(/export const (\w+) = createIconComponent\(\s*Nucleo\.(\w+),/gs),
].map(([, name, glyph]) => ({ name, glyph }));

describe("ui icon contract", () => {
  it("exports at least one icon", () => {
    expect(iconExports.length).toBeGreaterThan(100);
  });

  it("never points two icon names at the same drawing", () => {
    const namesByGlyph = new Map<string, string[]>();

    for (const { name, glyph } of iconExports) {
      namesByGlyph.set(glyph, [...(namesByGlyph.get(glyph) ?? []), name]);
    }

    const shared = [...namesByGlyph.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([glyph, names]) => `${glyph}: ${names.join(", ")}`);

    expect(shared).toEqual([]);
  });

  it("keeps every exported icon in use", () => {
    const consumers = sourceFiles
      .filter((url) => !url.pathname.endsWith("ui/icons.tsx"))
      .map((url) => readFileSync(url, "utf8"))
      .join("\n");

    const unused = iconExports
      .map(({ name }) => name)
      .filter((name) => !new RegExp(`\\b${name}\\b`).test(consumers));

    expect(unused).toEqual([]);
  });

  it("keeps the icon library behind a single module", () => {
    const leaked = sourceFiles
      .filter((url) => !url.pathname.endsWith("ui/icons.tsx"))
      .filter((url) => readFileSync(url, "utf8").includes("nucleo-ui-outline-18"))
      .map((url) => url.pathname);

    expect(leaked).toEqual([]);
  });

  it("imports icons under one name, with no local renames", () => {
    const renamed = sourceFiles.flatMap((url) => {
      const source = readFileSync(url, "utf8");
      const imports = [
        ...source.matchAll(/import[^;]*\{([^}]*)\}\s*from\s*"@\/ui\/(?:icons|brand-marks)"/gs),
      ];

      return imports
        .flatMap(([, specifiers]) => [...specifiers.matchAll(/(\w+)\s+as\s+(\w+)/g)])
        .map(([, imported, local]) => `${url.pathname}: ${imported} as ${local}`);
    });

    expect(renamed).toEqual([]);
  });

  it("pins the stroke to real pixels instead of the 18px drawing grid", () => {
    expect(iconStyles).toContain("vector-effect: non-scaling-stroke");
    expect(iconStyles).toContain("stroke-width: var(--icon-stroke, 1.25px)");
    expect(iconsSource).toContain('sm: "1.25px"');
    expect(iconsSource).toContain('md: "1.5px"');
    expect(iconsSource).toContain('lg: "2px"');
  });

  it("keeps brand marks out of the icon stroke system", () => {
    expect(brandSource).not.toContain("@/ui/icons");
    expect(brandSource).not.toContain("data-athas-icon");
  });

  it("gives every concept its own icon", () => {
    const byIcon = new Map<unknown, string[]>();

    for (const [concept, icon] of Object.entries(ICON_CONCEPTS)) {
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), concept]);
    }

    const shared = [...byIcon.values()].filter((concepts) => concepts.length > 1);

    expect(shared).toEqual([]);
  });
});

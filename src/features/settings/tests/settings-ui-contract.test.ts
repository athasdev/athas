import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const componentsDirectory = fileURLToPath(new URL("../components", import.meta.url));
const tabsDirectory = fileURLToPath(new URL("../components/tabs", import.meta.url));
const aiSelectorsDirectory = fileURLToPath(
  new URL("../../ai/components/selectors", import.meta.url),
);

const settingsComponentFiles = [
  ...readdirSync(componentsDirectory)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `${componentsDirectory}/${name}`),
  ...readdirSync(tabsDirectory)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `${tabsDirectory}/${name}`),
];

function collectButtonSizes(filePath: string) {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const sizes: Array<{ filePath: string; line: number; size: string | null }> = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const openingElement = ts.isJsxElement(node) ? node.openingElement : node;

      if (openingElement.tagName.getText(sourceFile) === "Button") {
        const sizeAttribute = openingElement.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "size",
        );
        const position = sourceFile.getLineAndCharacterOfPosition(openingElement.getStart());

        sizes.push({
          filePath,
          line: position.line + 1,
          size: sizeAttribute?.initializer?.getText(sourceFile).replace(/"/g, "") ?? null,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return sizes;
}

describe("settings UI contract", () => {
  it("uses the shared settings view spacing contract in every tab", () => {
    const tabFiles = readdirSync(tabsDirectory)
      .filter((name) => name.endsWith("-settings.tsx"))
      .map((name) => `${tabsDirectory}/${name}`);

    for (const filePath of tabFiles) {
      expect(readFileSync(filePath, "utf8"), filePath).toContain("<SettingsView");
    }
  });

  it("uses one standard size for text actions and explicit compact sizes for icon actions", () => {
    const buttonSizes = settingsComponentFiles.flatMap(collectButtonSizes);
    const invalidButtons = buttonSizes.filter(
      ({ size }) => size !== "sm" && size !== "icon-sm" && size !== "icon-xs",
    );

    expect(invalidButtons).toEqual([]);
  });

  it("keeps controls reachable without making the settings panel horizontally scrollable", () => {
    const dialogSource = readFileSync(`${componentsDirectory}/settings-dialog.tsx`, "utf8");
    const sectionSource = readFileSync(`${componentsDirectory}/settings-section.tsx`, "utf8");

    expect(dialogSource).toContain("@container/settings");
    expect(dialogSource).toContain('orientation="vertical"');
    expect(dialogSource).not.toContain('orientation="both"');
    expect(dialogSource).toContain("overflow-x-hidden");
    expect(sectionSource).toContain("@max-[640px]/settings:flex-col");
    expect(sectionSource).toContain("@max-[640px]/settings:w-full");
    expect(sectionSource).toContain("@max-[640px]/settings:[&>div]:flex-wrap");
  });

  it("content-sizes AI selector triggers and menus in settings", () => {
    for (const fileName of ["provider-selector.tsx", "model-selector.tsx"]) {
      const source = readFileSync(`${aiSelectorsDirectory}/${fileName}`, "utf8");

      expect(source, fileName).toContain('!isComposer && "w-fit max-w-full"');
      expect(source, fileName).toContain(
        'menuClassName="w-fit min-w-0 max-w-(--available-width) p-0"',
      );
    }
  });
});

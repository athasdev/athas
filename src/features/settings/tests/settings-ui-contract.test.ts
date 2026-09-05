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

function collectControlProps(filePath: string, tagName: "Button" | "Select") {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const controls: Array<{
    className: string | null;
    filePath: string;
    line: number;
    shape: string | null;
    size: string | null;
    variant: string | null;
    width: string | null;
  }> = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const openingElement = ts.isJsxElement(node) ? node.openingElement : node;

      if (openingElement.tagName.getText(sourceFile) === tagName) {
        const getAttribute = (name: string) =>
          openingElement.attributes.properties.find(
            (property): property is ts.JsxAttribute =>
              ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name,
          );
        const position = sourceFile.getLineAndCharacterOfPosition(openingElement.getStart());

        controls.push({
          className:
            getAttribute("className")?.initializer?.getText(sourceFile).replace(/"/g, "") ?? null,
          filePath,
          line: position.line + 1,
          shape: getAttribute("shape")?.initializer?.getText(sourceFile).replace(/"/g, "") ?? null,
          size: getAttribute("size")?.initializer?.getText(sourceFile).replace(/"/g, "") ?? null,
          variant:
            getAttribute("variant")?.initializer?.getText(sourceFile).replace(/"/g, "") ?? null,
          width: getAttribute("width")?.initializer?.getText(sourceFile).replace(/"/g, "") ?? null,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return controls;
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

  it("uses the canonical primitive geometry without local size selection", () => {
    const buttons = settingsComponentFiles.flatMap((filePath) =>
      collectControlProps(filePath, "Button"),
    );
    const selects = settingsComponentFiles.flatMap((filePath) =>
      collectControlProps(filePath, "Select"),
    );

    expect(buttons.filter(({ size }) => size !== null)).toEqual([]);
    expect(selects.filter(({ size }) => size !== null)).toEqual([]);
  });

  it("inherits the shared control shape instead of selecting pill surfaces", () => {
    const buttons = settingsComponentFiles.flatMap((filePath) =>
      collectControlProps(filePath, "Button"),
    );
    const selects = settingsComponentFiles.flatMap((filePath) =>
      collectControlProps(filePath, "Select"),
    );

    expect(buttons.filter(({ shape }) => shape !== null)).toEqual([]);
    expect(selects.filter(({ shape }) => shape !== null)).toEqual([]);
  });

  it("inherits shared control typography without tab-specific overrides", () => {
    const controls = settingsComponentFiles.flatMap((filePath) => [
      ...collectControlProps(filePath, "Button"),
      ...collectControlProps(filePath, "Select"),
    ]);

    expect(controls.filter(({ className }) => className?.includes("ui-text-"))).toEqual([]);
  });

  it("content-sizes selectors unless a form layout explicitly requests full width", () => {
    const selects = settingsComponentFiles.flatMap((filePath) =>
      collectControlProps(filePath, "Select"),
    );
    const widthUtility = /(^|[\s"'`])(w|min-w|max-w)-/;

    expect(selects.filter(({ className }) => className && widthUtility.test(className))).toEqual(
      [],
    );
    expect(selects.filter(({ width }) => width !== null && width !== "full")).toEqual([]);
  });

  it("keeps controls reachable without making the settings panel horizontally scrollable", () => {
    const settingsViewSource = readFileSync(
      `${componentsDirectory}/settings-workbench-view.tsx`,
      "utf8",
    );
    const sectionSource = readFileSync(`${componentsDirectory}/settings-section.tsx`, "utf8");

    expect(settingsViewSource).toContain("@container/settings");
    expect(settingsViewSource).toContain('orientation="vertical"');
    expect(settingsViewSource).not.toContain('orientation="both"');
    expect(settingsViewSource).toContain("overflow-x-hidden");
    expect(sectionSource).toContain("@max-[640px]/settings:flex-col");
    expect(sectionSource).toContain("@max-[640px]/settings:w-full");
    expect(sectionSource).toContain("@max-[640px]/settings:[&>div]:flex-wrap");
  });

  it("renders settings as a workbench surface with one keyboard-reachable scroll owner", () => {
    const settingsViewSource = readFileSync(
      `${componentsDirectory}/settings-workbench-view.tsx`,
      "utf8",
    );

    expect(settingsViewSource).toContain("bg-background");
    expect(settingsViewSource).not.toContain("<Dialog");
    expect(settingsViewSource).not.toContain("<Card");
    expect(settingsViewSource).not.toContain("tabIndex: -1");
  });

  it("keeps settings navigation in a persistent grouped sidebar", () => {
    const settingsViewSource = readFileSync(
      `${componentsDirectory}/settings-workbench-view.tsx`,
      "utf8",
    );
    const navigationSource = readFileSync(`${componentsDirectory}/settings-navigation.tsx`, "utf8");
    const sectionSource = readFileSync(`${componentsDirectory}/settings-section.tsx`, "utf8");
    const sidebarPaneSource = readFileSync(
      fileURLToPath(new URL("../../layout/components/sidebar/sidebar-pane.tsx", import.meta.url)),
      "utf8",
    );
    const modalSliceSource = readFileSync(
      fileURLToPath(new URL("../../window/stores/ui-state/modal-slice.ts", import.meta.url)),
      "utf8",
    );

    expect(settingsViewSource).toContain("<SettingsNavigation");
    expect(settingsViewSource).toContain("<SearchInput");
    expect(settingsViewSource).not.toContain("<ResourcePageHeader");
    expect(settingsViewSource).not.toContain("<ResourceCategoryNav");
    expect(settingsViewSource).not.toContain("<SettingsBreadcrumb");
    expect(navigationSource).toContain('aria-label="Settings sections"');
    expect(navigationSource).toContain("<SidebarSectionLabel");
    expect(navigationSource).toContain("<SidebarListItem");
    expect(sectionSource).toContain("<Card");
    expect(sectionSource).not.toContain("<Accordion");
    expect(sidebarPaneSource).not.toContain("SettingsSidebar");
    expect(modalSliceSource).not.toContain('setActiveView("settings")');
    expect(modalSliceSource).not.toContain("setIsSidebarVisible(true)");
    expect(settingsViewSource).toContain("settingsInitialSection");
    expect(settingsViewSource).toContain('section.scrollIntoView({ block: "start"');
  });

  it("content-sizes AI selector triggers and menus in settings", () => {
    for (const fileName of ["provider-selector.tsx", "model-selector.tsx"]) {
      const source = readFileSync(`${aiSelectorsDirectory}/${fileName}`, "utf8");

      expect(source, fileName).toContain('isComposer ? "w-fit max-w-');
      expect(source, fileName).toContain(': "w-fit max-w-full"');
      expect(source, fileName).toContain('menuWidth="content"');
    }
  });
});

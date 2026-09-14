import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const extensionsViewPath = fileURLToPath(
  new URL("../ui/components/extensions-view.tsx", import.meta.url),
);
const extensionControlsPath = fileURLToPath(
  new URL("../ui/components/extension-view-controls.tsx", import.meta.url),
);

describe("integrations UI contract", () => {
  it("uses the shared workbench, search, and category navigation", () => {
    const source = readFileSync(extensionsViewPath, "utf8");

    expect(source).toContain("<WorkbenchContent");
    expect(source).not.toContain("<WorkbenchNavigation");
    expect(source).toContain("<TabsList");
    expect(source).toContain("<ExtensionsBreadcrumb");
    expect(source).toContain("<SearchInput");
    expect(source).toContain('aria-label="Integration categories"');
  });

  it("makes form selectors full-width through the shared Select contract", () => {
    const source = readFileSync(extensionControlsPath, "utf8");
    const selectControl = source.slice(source.indexOf("export function ExtensionSelectControl"));

    expect(selectControl).toContain('width="full"');
    expect(selectControl).not.toContain('className="w-full"');
  });
});

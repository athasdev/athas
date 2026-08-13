import { describe, expect, it } from "vite-plus/test";
import { findUiSemanticContractViolations } from "../ui-semantic-contracts";

describe("UI semantic contract checks", () => {
  it("rejects visual escape hatches in menu item data", () => {
    const violations = findUiSemanticContractViolations(
      "src/features/example/menu.tsx",
      `
        const item = {
          id: "delete",
          label: "Delete",
          onClick: remove,
          className: "text-destructive",
          keybinding: <kbd>⌘D</kbd>,
        };
      `,
    );

    expect(violations).toEqual([
      expect.stringContaining("menu items must use semantic tone or selected props"),
      expect.stringContaining("menu shortcuts must use the canonical shortcut string prop"),
    ]);
  });

  it("rejects visual escape hatches in file navigator item data", () => {
    const violations = findUiSemanticContractViolations(
      "src/features/example/files.tsx",
      `
        const item = {
          key: "src/app.ts",
          path: "src/app.ts",
          iconClassName: "text-green-500",
          metadata: [{ label: "+3", className: "text-green-500" }],
        };
      `,
    );

    expect(violations).toEqual([
      expect.stringContaining("file navigator icons must use iconTone"),
      expect.stringContaining("file navigator metadata must use tone"),
    ]);
  });

  it("rejects fake separator content and behavior", () => {
    const violations = findUiSemanticContractViolations(
      "src/features/example/menu.tsx",
      `
        const separator = {
          id: "divider",
          separator: true,
          label: "",
          onClick: () => {},
        };
      `,
    );

    expect(violations).toEqual([
      expect.stringContaining("menu separators must not carry labels or click handlers"),
      expect.stringContaining("menu separators must not carry labels or click handlers"),
    ]);
  });

  it("rejects arbitrary select menu styling", () => {
    const violations = findUiSemanticContractViolations(
      "src/features/example/select.tsx",
      `<Select menuClassName="w-fit p-0" value={value} options={options} onChange={setValue} />`,
    );

    expect(violations).toEqual([
      expect.stringContaining("select menus must use semantic sizing props"),
    ]);
  });

  it("accepts semantic menu and file navigator data", () => {
    const violations = findUiSemanticContractViolations(
      "src/features/example/semantic.tsx",
      `
        const menu = {
          id: "delete",
          label: "Delete",
          onClick: remove,
          tone: "destructive",
          shortcut: "cmd+d",
        };
        const file = {
          key: "src/app.ts",
          path: "src/app.ts",
          iconTone: "modified",
          metadata: [{ label: "+3", tone: "added" }],
        };
        const select = (
          <Select menuWidth="content" value={value} options={options} onChange={setValue} />
        );
      `,
    );

    expect(violations).toEqual([]);
  });
});

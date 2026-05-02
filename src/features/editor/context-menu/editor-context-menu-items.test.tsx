import { describe, expect, it, vi } from "vite-plus/test";
import { buildEditorContextMenuItems } from "./editor-context-menu-items";

const baseOptions = {
  hasSelection: true,
  modifierKey: "Cmd",
  altKey: "Option",
};

function getItem(id: string, handlers = {}) {
  const item = buildEditorContextMenuItems({ ...baseOptions, ...handlers }).find(
    (entry) => entry.id === id,
  );

  if (!item) throw new Error(`Missing menu item ${id}`);
  return item;
}

describe("buildEditorContextMenuItems", () => {
  it("disables command items that do not have a handler", () => {
    expect(getItem("format").disabled).toBe(true);
    expect(getItem("go-to-definition").disabled).toBe(true);
    expect(getItem("bookmark").disabled).toBe(true);
  });

  it("enables command items when their handler is present", () => {
    expect(getItem("format", { onFormat: vi.fn() }).disabled).toBe(false);
    expect(getItem("go-to-definition", { onGoToDefinition: vi.fn() }).disabled).toBe(false);
  });

  it("keeps selection-only commands disabled without a selection", () => {
    const [copy, toggleCase] = ["copy", "toggle-case"].map((id) =>
      buildEditorContextMenuItems({
        ...baseOptions,
        hasSelection: false,
        onCopy: vi.fn(),
        onToggleCase: vi.fn(),
      }).find((entry) => entry.id === id),
    );

    expect(copy?.disabled).toBe(true);
    expect(toggleCase?.disabled).toBe(true);
  });
});

import { describe, expect, it, vi } from "vite-plus/test";
import { buildEditorContextMenuGroups } from "../context-menu/editor-context-menu-items";

const baseOptions = {
  hasSelection: true,
};

function getItem(id: string, handlers = {}) {
  const item = buildEditorContextMenuGroups({
    ...baseOptions,
    ...handlers,
  })
    .flatMap((group) => group.items)
    .find((entry) => entry.id === id);

  if (!item) throw new Error(`Missing menu item ${id}`);
  return item;
}

describe("buildEditorContextMenuGroups", () => {
  it("keeps the context menu to three focused groups", () => {
    const groups = buildEditorContextMenuGroups(baseOptions);

    expect(groups.map((group) => group.id)).toEqual(["editing", "code", "navigation"]);
    expect(groups.flatMap((group) => group.items)).toHaveLength(13);
  });

  it("disables commands that do not have a handler", () => {
    expect(getItem("format-selection").disabled).toBe(true);
    expect(getItem("go-to-definition").disabled).toBe(true);
    expect(getItem("quick-fix").disabled).toBe(true);
  });

  it("enables commands when their handler is present", () => {
    expect(getItem("format-selection", { onFormatSelection: vi.fn() }).disabled).toBe(false);
    expect(getItem("go-to-definition", { onGoToDefinition: vi.fn() }).disabled).toBe(false);
    expect(getItem("quick-fix", { onQuickFix: vi.fn() }).disabled).toBe(false);
  });

  it("keeps selection-only commands disabled without a selection", () => {
    const handlers = {
      hasSelection: false,
      onCopy: vi.fn(),
      onFormat: vi.fn(),
      onToggleCase: vi.fn(),
    };

    expect(getItem("copy", handlers).disabled).toBe(true);
    expect(getItem("format", handlers).disabled).toBe(false);
    expect(getItem("toggle-case", handlers).disabled).toBe(true);
  });
});

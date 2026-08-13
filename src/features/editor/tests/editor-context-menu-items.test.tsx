import { describe, expect, it, vi } from "vite-plus/test";
import { isMenuActionItem } from "@/ui/dropdown";
import { buildEditorContextMenuItems } from "../context-menu/editor-context-menu-items";

const baseOptions = {
  hasSelection: true,
};

function getItem(id: string, handlers = {}) {
  const item = buildEditorContextMenuItems({
    ...baseOptions,
    ...handlers,
  }).find((entry) => entry.id === id);

  if (!item || !isMenuActionItem(item)) throw new Error(`Missing menu item ${id}`);
  return item;
}

describe("buildEditorContextMenuItems", () => {
  it("disables command items that do not have a handler", () => {
    expect(getItem("format").disabled).toBe(true);
    expect(getItem("format-selection").disabled).toBe(true);
    expect(getItem("go-to-definition").disabled).toBe(true);
    expect(getItem("quick-fix").disabled).toBe(true);
    expect(getItem("bookmark").disabled).toBe(true);
  });

  it("enables command items when their handler is present", () => {
    expect(getItem("format", { onFormat: vi.fn() }).disabled).toBe(false);
    expect(
      getItem("select-next-occurrence", {
        onSelectNextOccurrence: vi.fn(),
      }).disabled,
    ).toBe(false);
    expect(getItem("go-to-definition", { onGoToDefinition: vi.fn() }).disabled).toBe(false);
    expect(getItem("trigger-suggest", { onTriggerSuggest: vi.fn() }).disabled).toBe(false);
  });

  it("describes shortcuts with canonical keybinding strings", () => {
    expect(getItem("copy").shortcut).toBe("cmd+c");
    expect(getItem("format").shortcut).toBe("shift+alt+f");
    expect(getItem("format-selection").shortcut).toBe("cmd+k cmd+f");
  });

  it("keeps selection-only commands disabled without a selection", () => {
    const handlers = {
      hasSelection: false,
      onCopy: vi.fn(),
      onFormatSelection: vi.fn(),
      onToggleCase: vi.fn(),
    };

    expect(getItem("copy", handlers).disabled).toBe(true);
    expect(getItem("toggle-case", handlers).disabled).toBe(true);
    expect(getItem("format-selection", handlers).disabled).toBe(true);
  });
});

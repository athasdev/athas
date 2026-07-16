import { describe, expect, it, vi } from "vite-plus/test";
import { setDefinitionLinkCursor } from "@/features/editor/lsp/use-definition-link";

function cursorTarget() {
  return {
    style: {
      removeProperty: vi.fn(),
      setProperty: vi.fn(),
    },
  };
}

describe("definition link cursor", () => {
  it("sets the pointer only on editor text surfaces", () => {
    const textSurface = cursorTarget();
    const editor = {
      style: cursorTarget().style,
      querySelectorAll: vi.fn(() => [textSurface]),
    } as unknown as HTMLElement;

    setDefinitionLinkCursor(editor, true);

    expect(editor.style.removeProperty).toHaveBeenCalledWith("cursor");
    expect(editor.style.setProperty).not.toHaveBeenCalled();
    expect(textSurface.style.setProperty).toHaveBeenCalledWith("cursor", "pointer");
  });

  it("removes stale pointer styles from the shell and text surfaces", () => {
    const textSurface = cursorTarget();
    const editor = {
      style: cursorTarget().style,
      querySelectorAll: vi.fn(() => [textSurface]),
    } as unknown as HTMLElement;

    setDefinitionLinkCursor(editor, false);

    expect(editor.style.removeProperty).toHaveBeenCalledWith("cursor");
    expect(textSurface.style.removeProperty).toHaveBeenCalledWith("cursor");
  });
});

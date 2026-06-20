import { describe, expect, it } from "vite-plus/test";
import { resolvePreCompletionKeyEdit } from "@/features/editor/engines/athas/utils/editor-key-edits";

describe("Athas editor key edits", () => {
  it.each(["Backspace", "Delete"])("collapses the selection after deleting it with %s", (key) => {
    const result = resolvePreCompletionKeyEdit({
      keyState: {
        key,
        content: "const alpha = beta;",
        selectionStart: 6,
        selectionEnd: 11,
        tabSize: 2,
      },
      hasBlockedModifier: false,
      autocompleteCompletion: null,
      isLspCompletionVisible: false,
    });

    expect(result).toEqual({
      type: "edit",
      content: "const  = beta;",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("normalizes backward selections before deleting them", () => {
    const result = resolvePreCompletionKeyEdit({
      keyState: {
        key: "Backspace",
        content: "const alpha = beta;",
        selectionStart: 11,
        selectionEnd: 6,
        tabSize: 2,
      },
      hasBlockedModifier: false,
      autocompleteCompletion: null,
      isLspCompletionVisible: false,
    });

    expect(result).toEqual({
      type: "edit",
      content: "const  = beta;",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("does not accept inline completion on Shift+Tab", () => {
    const result = resolvePreCompletionKeyEdit({
      keyState: {
        key: "Tab",
        shiftKey: true,
        content: "const value",
        selectionStart: 5,
        selectionEnd: 5,
        tabSize: 2,
      },
      hasBlockedModifier: false,
      autocompleteCompletion: { text: " extra", cursorOffset: 5 },
      isLspCompletionVisible: false,
    });

    expect(result).toBeNull();
  });
});

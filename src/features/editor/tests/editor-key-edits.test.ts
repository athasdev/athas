import { describe, expect, it } from "vite-plus/test";
import {
  resolvePostCompletionKeyEdit,
  resolvePreCompletionKeyEdit,
} from "../utils/editor-key-edits";

describe("editor key edit resolution", () => {
  it("resolves auto pair insertion before completion handling", () => {
    expect(
      resolvePreCompletionKeyEdit({
        keyState: {
          key: "(",
          content: "call",
          selectionStart: 4,
          selectionEnd: 4,
          tabSize: 2,
        },
        hasBlockedModifier: false,
        autocompleteCompletion: null,
        isLspCompletionVisible: false,
      }),
    ).toEqual({
      type: "edit",
      content: "call()",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("moves over an existing auto pair closer without editing content", () => {
    expect(
      resolvePreCompletionKeyEdit({
        keyState: {
          key: ")",
          content: "call()",
          selectionStart: 5,
          selectionEnd: 5,
          tabSize: 2,
        },
        hasBlockedModifier: false,
        autocompleteCompletion: null,
        isLspCompletionVisible: false,
      }),
    ).toEqual({
      type: "move-cursor",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("accepts inline autocomplete on tab only when the LSP menu is hidden", () => {
    expect(
      resolvePreCompletionKeyEdit({
        keyState: {
          key: "Tab",
          content: "con",
          selectionStart: 3,
          selectionEnd: 3,
          tabSize: 2,
        },
        hasBlockedModifier: false,
        autocompleteCompletion: { text: "st value", cursorOffset: 3 },
        isLspCompletionVisible: false,
      }),
    ).toEqual({
      type: "edit",
      content: "const value",
      selectionStart: 11,
      selectionEnd: 11,
      clearAutocomplete: true,
    });

    expect(
      resolvePreCompletionKeyEdit({
        keyState: {
          key: "Tab",
          content: "con",
          selectionStart: 3,
          selectionEnd: 3,
          tabSize: 2,
        },
        hasBlockedModifier: false,
        autocompleteCompletion: { text: "st value", cursorOffset: 3 },
        isLspCompletionVisible: true,
      }),
    ).toBeNull();
  });

  it("resolves smart enter after completion handling", () => {
    expect(
      resolvePostCompletionKeyEdit({
        key: "Enter",
        content: "  // todo",
        selectionStart: "  // todo".length,
        selectionEnd: "  // todo".length,
        languageId: "typescript",
        tabSize: 2,
      }),
    ).toEqual({
      type: "edit",
      content: "  // todo\n  // ",
      selectionStart: "  // todo\n  // ".length,
      selectionEnd: "  // todo\n  // ".length,
    });
  });

  it("resolves tab indentation after completion handling", () => {
    expect(
      resolvePostCompletionKeyEdit({
        key: "Tab",
        content: "one\ntwo",
        selectionStart: 0,
        selectionEnd: 7,
        tabSize: 2,
      }),
    ).toEqual({
      type: "edit",
      content: "  one\n  two",
      selectionStart: 2,
      selectionEnd: 11,
    });
  });
});

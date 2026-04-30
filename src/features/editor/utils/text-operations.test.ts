import { describe, expect, it } from "vite-plus/test";
import { indentText, outdentText, toggleCaseText } from "./text-operations";

describe("editor text operations", () => {
  it("inserts indentation at the cursor", () => {
    expect(indentText("let value", 4, 4, "  ")).toEqual({
      content: "let   value",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("indents every selected line", () => {
    expect(indentText("one\ntwo\nthree", 0, 7, "  ")).toEqual({
      content: "  one\n  two\nthree",
      selectionStart: 2,
      selectionEnd: 11,
    });
  });

  it("outdents the current line without moving before the line start", () => {
    expect(outdentText("  value", 4, 4, 2)).toEqual({
      content: "value",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("outdents all selected lines", () => {
    expect(outdentText("  one\n\ttwo\nthree", 0, 11, 2)).toEqual({
      content: "one\ntwo\nthree",
      selectionStart: 0,
      selectionEnd: 8,
    });
  });

  it("toggles selected text case", () => {
    expect(toggleCaseText("hello WORLD", 0, 5)).toEqual({
      content: "HELLO WORLD",
      selectionStart: 0,
      selectionEnd: 5,
    });

    expect(toggleCaseText("HELLO WORLD", 0, 5)).toEqual({
      content: "hello WORLD",
      selectionStart: 0,
      selectionEnd: 5,
    });
  });
});

import { describe, expect, it } from "vite-plus/test";
import {
  getAutoIndentInsertText,
  getBlockCommentExpansion,
  getCommentContinuation,
  getSmartEnterInsertText,
  isBlockCommentLanguage,
} from "../utils/auto-indent";

describe("auto indent", () => {
  it("carries leading indentation from the current line prefix", () => {
    expect(getAutoIndentInsertText("    const value = 1;", 10)).toBe("\n    ");
    expect(getAutoIndentInsertText("\t\treturn value;", 5)).toBe("\n\t\t");
  });

  it("does not use indentation that appears after the cursor", () => {
    expect(getAutoIndentInsertText("foo    bar", 3)).toBe("\n");
  });

  it("continues line comments when enter splits commented text", () => {
    expect(getSmartEnterInsertText("  // todo", "  // todo".length, "typescript")).toEqual({
      insertText: "\n  // ",
      cursorOffset: 6,
    });
    expect(getCommentContinuation("python", "  # todo", "")).toEqual({
      insertText: "\n  # ",
      cursorOffset: 5,
    });
  });

  it("expands block comments with the cursor inside the pair", () => {
    expect(isBlockCommentLanguage("typescript")).toBe(true);
    expect(getSmartEnterInsertText("/** */", 3, "typescript")).toEqual({
      insertText: "\n * \n",
      cursorOffset: 4,
    });
    expect(getBlockCommentExpansion("typescript", "/")).toEqual({
      insertText: "* */",
      cursorOffset: 2,
    });
    expect(getBlockCommentExpansion("python", "/")).toBeNull();
  });
});

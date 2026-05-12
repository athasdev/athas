import { describe, expect, it } from "vite-plus/test";
import {
  applyAutoPairEdit,
  getAutoPairDeleteRange,
  getAutoPairEdit,
  getAutoPairSkipOffset,
} from "../utils/auto-pair";

describe("auto pair utilities", () => {
  it("inserts matching pairs and keeps the cursor inside", () => {
    const edit = getAutoPairEdit("(", "call", 4, 4);

    expect(edit).toEqual({
      start: 4,
      end: 4,
      insertText: "()",
      cursorOffset: 1,
      selectionStartOffset: undefined,
      selectionEndOffset: undefined,
    });
    expect(edit ? applyAutoPairEdit("call", edit) : "").toBe("call()");
  });

  it("wraps selected text", () => {
    const edit = getAutoPairEdit('"', "return value", 7, 12);

    expect(edit).toMatchObject({
      start: 7,
      end: 12,
      insertText: '"value"',
      cursorOffset: 1,
      selectionStartOffset: 8,
      selectionEndOffset: 13,
    });
    expect(edit ? applyAutoPairEdit("return value", edit) : "").toBe('return "value"');
  });

  it("skips over existing closing characters", () => {
    expect(getAutoPairSkipOffset(")", "call()", 5, 5)).toBe(6);
    expect(getAutoPairSkipOffset(")", "call()", 4, 4)).toBeNull();
  });

  it("deletes paired characters together", () => {
    expect(getAutoPairDeleteRange("call()", 5)).toEqual({ start: 4, end: 6 });
    expect(getAutoPairDeleteRange("call(x)", 5)).toBeNull();
  });

  it("does not pair apostrophes inside words", () => {
    expect(getAutoPairEdit("'", "dont", 4, 4)).toBeNull();
  });
});

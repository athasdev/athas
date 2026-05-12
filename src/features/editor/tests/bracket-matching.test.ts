import { describe, expect, it } from "vite-plus/test";
import {
  findBracketJumpTarget,
  findBracketSelectionRange,
  findMatchingBracketAtCursor,
  removeBracketPairAtCursor,
} from "../utils/bracket-matching";

describe("bracket matching", () => {
  it("matches an opening bracket next to the cursor", () => {
    expect(findMatchingBracketAtCursor("fn call(value)", "fn call(".length)).toMatchObject({
      activeOffset: "fn call".length,
      matchingOffset: "fn call(value".length,
      activeBracket: "(",
      matchingBracket: ")",
      direction: "forward",
    });
  });

  it("matches a closing bracket before the cursor", () => {
    expect(findMatchingBracketAtCursor("items[0]", "items[0]".length)).toMatchObject({
      activeOffset: "items[0".length,
      matchingOffset: "items".length,
      activeBracket: "]",
      matchingBracket: "[",
      direction: "backward",
    });
  });

  it("tracks nested brackets of the same type", () => {
    const content = "outer(inner(value))";

    expect(findMatchingBracketAtCursor(content, "outer(".length)?.matchingOffset).toBe(
      content.length - 1,
    );
  });

  it("returns the active bracket without a match when scan budget is exceeded", () => {
    expect(findMatchingBracketAtCursor("(too far)", 1, { maxScanChars: 2 })).toEqual({
      activeOffset: 0,
      matchingOffset: null,
      activeBracket: "(",
      matchingBracket: ")",
      direction: "forward",
    });
  });

  it("ignores non-bracket cursor positions", () => {
    expect(findMatchingBracketAtCursor("alpha", 3)).toBeNull();
  });
});

describe("bracket jump target", () => {
  it("jumps to the matching bracket when the cursor is on a bracket", () => {
    expect(findBracketJumpTarget("fn call(value)", "fn call(".length)).toEqual({
      offset: "fn call(value".length,
      reason: "matching",
    });
  });

  it("jumps to the enclosing closing bracket when the cursor is inside brackets", () => {
    expect(findBracketJumpTarget("fn call(value)", "fn call(va".length)).toEqual({
      offset: "fn call(value".length,
      reason: "enclosing",
    });
  });

  it("jumps to the next bracket when no enclosing pair exists", () => {
    expect(findBracketJumpTarget("alpha beta()", "alpha ".length)).toEqual({
      offset: "alpha beta".length,
      reason: "next",
    });
  });

  it("returns null when no bracket is available in the scan budget", () => {
    expect(findBracketJumpTarget("alpha beta()", 0, { maxScanChars: 2 })).toBeNull();
  });
});

describe("bracket selection range", () => {
  it("selects the matching pair when the cursor is on a bracket", () => {
    expect(findBracketSelectionRange("fn call(value)", "fn call(".length)).toEqual({
      startOffset: "fn call".length,
      endOffset: "fn call(value)".length,
    });
  });

  it("selects inside brackets when bracket characters are excluded", () => {
    expect(
      findBracketSelectionRange("fn call(value)", "fn call(va".length, {
        selectBrackets: false,
      }),
    ).toEqual({
      startOffset: "fn call(".length,
      endOffset: "fn call(value".length,
    });
  });

  it("selects the enclosing pair from inside a bracket range", () => {
    expect(findBracketSelectionRange("outer(inner(value))", "outer(i".length)).toEqual({
      startOffset: "outer".length,
      endOffset: "outer(inner(value))".length,
    });
  });

  it("selects the next bracket pair when outside brackets", () => {
    expect(findBracketSelectionRange("alpha beta()", "alpha ".length)).toEqual({
      startOffset: "alpha beta".length,
      endOffset: "alpha beta()".length,
    });
  });
});

describe("bracket removal", () => {
  it("removes a bracket pair when the cursor is on the opening bracket", () => {
    expect(removeBracketPairAtCursor("var x = (value);", "var x = (".length)).toEqual({
      content: "var x = value;",
      cursorOffset: "var x = ".length,
    });
  });

  it("removes the enclosing bracket pair from inside nested brackets", () => {
    expect(removeBracketPairAtCursor("var x = (3 + (5-7));", "var x = (3 + (5".length)).toEqual({
      content: "var x = (3 + 5-7);",
      cursorOffset: "var x = (3 + 5".length,
    });
  });

  it("returns null when there is no bracket pair at or around the cursor", () => {
    expect(removeBracketPairAtCursor("alpha beta", 3)).toBeNull();
  });
});

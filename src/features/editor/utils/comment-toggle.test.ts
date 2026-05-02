import { describe, expect, it } from "vite-plus/test";
import { toggleLineComment } from "./comment-toggle";

describe("toggleLineComment", () => {
  it("keeps the cursor on the same code when commenting a line", () => {
    const result = toggleLineComment({
      content: "const value = 1;",
      selectionStart: 6,
      selectionEnd: 6,
    });

    expect(result).toEqual({
      content: "// const value = 1;",
      selectionStart: 9,
      selectionEnd: 9,
    });
  });

  it("preserves indentation when uncommenting a line without a following space", () => {
    const result = toggleLineComment({
      content: "  //const value = 1;",
      selectionStart: 5,
      selectionEnd: 5,
    });

    expect(result).toEqual({
      content: "  const value = 1;",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("toggles every selected non-empty line", () => {
    const result = toggleLineComment({
      content: "one\n  two\n\nthree",
      selectionStart: 0,
      selectionEnd: "one\n  two\n\nthree".length,
    });

    expect(result.content).toBe("// one\n  // two\n\n// three");
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe("// one\n  // two\n\n// three".length);
  });

  it("excludes the next line when a selection ends at line start", () => {
    const result = toggleLineComment({
      content: "one\ntwo",
      selectionStart: 0,
      selectionEnd: 4,
    });

    expect(result.content).toBe("// one\ntwo");
  });
});

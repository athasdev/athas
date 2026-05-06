import { describe, expect, it } from "vite-plus/test";
import {
  classifyUndoEdit,
  shouldStartNewUndoGroup,
  type UndoEditOperation,
} from "@/features/editor/history/undo-grouping";

describe("undo grouping", () => {
  it("keeps continuous character typing in one undo group", () => {
    let previousOperation: UndoEditOperation = "other";

    for (const [previousContent, nextContent] of [
      ["", "a"],
      ["a", "as"],
      ["as", "asd"],
      ["asd", "asda"],
      ["asda", "asdas"],
      ["asdas", "asdasd"],
    ] as const) {
      const operation = classifyUndoEdit(previousContent, nextContent, previousOperation);

      expect(operation).toBe("typing.other");
      expect(shouldStartNewUndoGroup(previousOperation, operation)).toBe(
        previousOperation === "other",
      );

      previousOperation = operation;
    }
  });

  it("matches VS Code style spacing boundaries", () => {
    const firstSpace = classifyUndoEdit("abc", "abc ", "typing.other");
    const nextCharacter = classifyUndoEdit("abc ", "abc d", firstSpace);
    const consecutiveSpace = classifyUndoEdit("abc ", "abc  ", firstSpace);

    expect(firstSpace).toBe("typing.first-space");
    expect(shouldStartNewUndoGroup("typing.other", firstSpace)).toBe(true);
    expect(shouldStartNewUndoGroup(firstSpace, nextCharacter)).toBe(false);
    expect(consecutiveSpace).toBe("typing.consecutive-space");
  });

  it("separates typing from delete and groups repeated deletes", () => {
    const deleteOperation = classifyUndoEdit("asdasd", "asdas", "typing.other");

    expect(deleteOperation).toBe("delete");
    expect(shouldStartNewUndoGroup("typing.other", deleteOperation)).toBe(true);
    expect(shouldStartNewUndoGroup(deleteOperation, "delete")).toBe(false);
  });

  it("keeps non-typing replacements atomic", () => {
    expect(shouldStartNewUndoGroup("replace", "replace")).toBe(true);
    expect(shouldStartNewUndoGroup("other", "other")).toBe(true);
  });
});

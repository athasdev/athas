import { describe, expect, it } from "vite-plus/test";
import {
  classifyUndoEdit,
  getUndoEditDelta,
  shouldStartNewUndoGroupForDelta,
  shouldStartNewUndoGroup,
  type UndoEditDelta,
  type UndoEditOperation,
} from "@/features/editor/history/undo-grouping";

describe("undo grouping", () => {
  function collectSnapshots(contents: string[]): string[] {
    let previousOperation: UndoEditOperation = "other";
    let pendingGroup: {
      baseContent: string;
      latestContent: string;
      operation: UndoEditOperation;
      lastDelta: UndoEditDelta;
    } | null = null;
    const snapshots: string[] = [];

    for (let index = 1; index < contents.length; index += 1) {
      const previousContent = contents[index - 1];
      const nextContent = contents[index];
      const delta = getUndoEditDelta(previousContent, nextContent, previousOperation);
      const operation = delta.operation;

      if (
        pendingGroup &&
        shouldStartNewUndoGroupForDelta(pendingGroup.operation, pendingGroup.lastDelta, delta)
      ) {
        snapshots.push(pendingGroup.baseContent);
        pendingGroup = {
          baseContent: previousContent,
          latestContent: nextContent,
          operation,
          lastDelta: delta,
        };
      } else if (pendingGroup) {
        pendingGroup.latestContent = nextContent;
        pendingGroup.operation = operation;
        pendingGroup.lastDelta = delta;
      } else {
        pendingGroup = {
          baseContent: previousContent,
          latestContent: nextContent,
          operation,
          lastDelta: delta,
        };
      }

      previousOperation = operation;
    }

    if (pendingGroup) {
      snapshots.push(pendingGroup.baseContent);
    }

    return snapshots;
  }

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

  it("groups typing after a line break with the line break", () => {
    expect(
      collectSnapshots(["", "a", "as", "asd", "asd\n", "asd\na", "asd\nas", "asd\nasd"]),
    ).toEqual(["", "asd"]);
  });

  it("starts a new group when typing resumes at a different offset", () => {
    expect(collectSnapshots(["", "a", "ab", "abc", "xabc"])).toEqual(["", "abc"]);
  });

  it("does not retain huge inserted text in undo delta metadata", () => {
    const pastedText = "x".repeat(300 * 1024);
    const delta = getUndoEditDelta("", pastedText);

    expect(delta.operation).toBe("other");
    expect(delta.insertedText).toBe("");
    expect(delta.insertedLength).toBe(pastedText.length);
    expect(delta.endOffset).toBe(pastedText.length);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { createLocalHistoryDiff } from "../utils/local-history-diff";

describe("createLocalHistoryDiff", () => {
  it("keeps anchors around large repeated sections instead of replacing the whole file", () => {
    const oldContent = [
      "header",
      ...Array.from({ length: 700 }, () => "same"),
      "old value",
      ...Array.from({ length: 700 }, () => "same"),
      "footer",
    ].join("\n");
    const newContent = oldContent.replace("old value", "new value");

    const diff = createLocalHistoryDiff({
      filePath: "/workspace/example.txt",
      oldContent,
      newContent,
    });

    const removedLines = diff.lines.filter((line) => line.line_type === "removed");
    const addedLines = diff.lines.filter((line) => line.line_type === "added");
    const contextLines = diff.lines.filter((line) => line.line_type === "context");

    expect(removedLines.map((line) => line.content)).toEqual(["old value"]);
    expect(addedLines.map((line) => line.content)).toEqual(["new value"]);
    expect(contextLines.some((line) => line.content === "header")).toBe(true);
    expect(contextLines.some((line) => line.content === "footer")).toBe(true);
  });
});

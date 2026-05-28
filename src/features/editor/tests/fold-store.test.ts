import { afterEach, describe, expect, it } from "vite-plus/test";
import { useFoldStore } from "../stores/fold-store";

describe("fold store", () => {
  afterEach(() => {
    useFoldStore.setState({ foldsByFile: new Map() });
  });

  it("computes indentation folds without materializing a line array", () => {
    const actions = useFoldStore.getState().actions;
    actions.computeFoldRegions(
      "/workspace/app.ts",
      ["function main() {", "  if (ready) {", "    run();", "  }", "}"].join("\n"),
    );

    expect(actions.getFoldRegions("/workspace/app.ts")).toEqual([
      { startLine: 1, endLine: 2, indentLevel: 2, kind: "generic" },
      { startLine: 0, endLine: 3, indentLevel: 0, kind: "generic" },
    ]);
  });

  it("detects diff file folds across CRLF content", () => {
    const actions = useFoldStore.getState().actions;
    actions.computeFoldRegions(
      "diff-editor://changes",
      "\uE000ATHAS_DIFF_FILE a.ts\r\n+one\r\n\uE000ATHAS_DIFF_FILE b.ts\r\n+two",
    );

    expect(actions.getFoldRegions("diff-editor://changes")).toEqual([
      { startLine: 0, endLine: 1, indentLevel: 0, kind: "diff-file" },
      { startLine: 2, endLine: 3, indentLevel: 0, kind: "diff-file" },
    ]);
  });

  it("drops collapsed lines that are no longer foldable after recompute", () => {
    const actions = useFoldStore.getState().actions;
    const filePath = "/workspace/app.ts";

    actions.computeFoldRegions(filePath, "a\n  b");
    actions.toggleFold(filePath, 0);
    expect(actions.getCollapsedLines(filePath)).toEqual([0]);

    actions.computeFoldRegions(filePath, "a\nb");
    expect(actions.getCollapsedLines(filePath)).toEqual([]);
  });

  it("folds regions at a requested nesting level", () => {
    const actions = useFoldStore.getState().actions;
    const filePath = "/workspace/app.ts";

    actions.computeFoldRegions(
      filePath,
      ["root", "  first", "    child", "  second", "    child", "tail"].join("\n"),
    );

    actions.foldLevel(filePath, 2);
    expect(actions.getCollapsedLines(filePath)).toEqual([1, 3]);

    actions.foldLevel(filePath, 1);
    expect(actions.getCollapsedLines(filePath)).toEqual([0, 1, 3]);
  });
});

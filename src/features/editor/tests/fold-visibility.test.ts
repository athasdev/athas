import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { useFoldStore } from "../stores/fold.store";

const FILE = "/ws/app.py";
const SOURCE = ["def main():", "\tif ready:", "\t\trun()", "\tdone()", "print()"].join("\n");
const actions = () => useFoldStore.getState().actions;

beforeEach(() => {
  actions().computeFoldRegions(FILE, SOURCE);
});

afterEach(() => {
  useFoldStore.setState({ foldsByFile: new Map() });
});

describe("fold visibility", () => {
  it("measures tab indentation when finding fold regions", () => {
    expect(
      actions()
        .getFoldRegions(FILE)
        .map((region) => [region.startLine, region.endLine]),
    ).toEqual(
      expect.arrayContaining([
        [0, 3],
        [1, 2],
      ]),
    );
  });

  it("hides the body of a collapsed region and reveals it again", () => {
    expect(actions().isFoldable(FILE, 0)).toBe(true);
    expect(actions().isFoldable(FILE, 2)).toBe(false);

    actions().toggleFold(FILE, 0);
    expect(actions().isCollapsed(FILE, 0)).toBe(true);
    expect([0, 1, 2, 3, 4].map((line) => actions().isHidden(FILE, line))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);

    actions().toggleFold(FILE, 0);
    expect(actions().isHidden(FILE, 2)).toBe(false);
  });

  it("restores only collapsed lines that are still foldable", () => {
    actions().setCollapsedLines(FILE, [3, 1, 0]);
    expect(actions().getCollapsedLines(FILE)).toEqual([0, 1]);

    actions().unfoldAll(FILE);
    expect(actions().getCollapsedLines(FILE)).toEqual([]);
  });

  it("keeps restored folds for a file whose regions are not computed yet", () => {
    actions().setCollapsedLines("/ws/later.py", [8, 2]);
    expect(actions().getCollapsedLines("/ws/later.py")).toEqual([2, 8]);
  });

  it("answers for unknown files and forgets a file's folds", () => {
    expect(actions().isFoldable("/ws/none.py", 0)).toBe(false);
    expect(actions().isCollapsed("/ws/none.py", 0)).toBe(false);
    expect(actions().isHidden("/ws/none.py", 1)).toBe(false);
    expect(actions().getFoldRegions("/ws/none.py")).toEqual([]);
    expect(actions().getCollapsedLines("/ws/none.py")).toEqual([]);

    actions().toggleFold(FILE, 0);
    actions().clearFolds(FILE);
    expect(actions().getFoldRegions(FILE)).toEqual([]);
    expect(actions().isHidden(FILE, 1)).toBe(false);
  });
});

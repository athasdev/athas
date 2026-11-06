import { describe, expect, it } from "vite-plus/test";
import { isInvalidDropTarget } from "../hooks/use-file-explorer-drag-drop";
import { getSelectionActionTargets, withoutNestedEntries } from "../utils/file-tree-selection";

const entry = (path: string, isDir = false) => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  isDir,
});

describe("file tree selection", () => {
  it("drops duplicates and entries inside selected folders", () => {
    expect(
      withoutNestedEntries([
        entry("/r/src", true),
        entry("/r/src/a.ts"),
        entry("/r/srcx.ts"),
        entry("/r/srcx.ts"),
      ]).map((item) => item.path),
    ).toEqual(["/r/src", "/r/srcx.ts"]);
  });

  it("uses the selection only when the row is part of it", () => {
    const selection = [entry("/r/a.ts"), entry("/r/b.ts")];

    expect(getSelectionActionTargets(entry("/r/a.ts"), selection)).toEqual(selection);
    expect(getSelectionActionTargets(entry("/r/c.ts"), selection)).toEqual([entry("/r/c.ts")]);
    expect(getSelectionActionTargets(entry("/r/a.ts"), null)).toEqual([entry("/r/a.ts")]);
  });

  it("refuses drops on any dragged entry or inside any dragged folder", () => {
    const dragged = [entry("/r/src", true), entry("/r/lib/a.ts")];

    expect(isInvalidDropTarget("/r/src", dragged)).toBe(true);
    expect(isInvalidDropTarget("/r/src/deep/x.ts", dragged)).toBe(true);
    expect(isInvalidDropTarget("/r/lib/a.ts", dragged)).toBe(true);
    expect(isInvalidDropTarget("/r/lib", dragged)).toBe(false);
    expect(isInvalidDropTarget("/r/srcx", dragged)).toBe(false);
  });
});

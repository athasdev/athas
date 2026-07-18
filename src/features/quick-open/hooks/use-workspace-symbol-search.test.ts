import { describe, expect, it } from "vite-plus/test";
import {
  getActiveProjectWorkspaces,
  getWorkspaceSymbolKey,
  mergeWorkspaceSymbolResults,
  type WorkspaceSymbolItem,
} from "./use-workspace-symbol-search";

const createSymbol = (
  name: string,
  overrides: Partial<WorkspaceSymbolItem> = {},
): WorkspaceSymbolItem => ({
  name,
  kind: "function",
  line: 1,
  character: 2,
  filePath: "/repo/src/index.ts",
  ...overrides,
});

describe("getActiveProjectWorkspaces", () => {
  it("matches all active language-server roots in the current project", () => {
    expect(
      getActiveProjectWorkspaces(["/repo"], ["/repo", "/repo/packages/app", "/repo-other"]),
    ).toEqual(["/repo", "/repo/packages/app"]);
  });

  it("includes active roots from every declared workspace folder", () => {
    expect(
      getActiveProjectWorkspaces(["/repo", "/shared"], ["/repo", "/shared/packages/app", "/other"]),
    ).toEqual(["/repo", "/shared/packages/app"]);
  });

  it("matches Windows paths across case and separator differences", () => {
    expect(getActiveProjectWorkspaces(["C:\\Repo"], ["c:/repo", "D:\\Repo"])).toEqual(["c:/repo"]);
  });

  it("handles trailing separators without matching sibling prefixes", () => {
    expect(getActiveProjectWorkspaces(["/repo/"], ["/repo", "/repo-other"])).toEqual(["/repo"]);
  });
});

describe("getWorkspaceSymbolKey", () => {
  it("distinguishes symbols with different names at the same location", () => {
    const first = createSymbol("first");
    const second = createSymbol("second");

    expect(getWorkspaceSymbolKey(first)).not.toBe(getWorkspaceSymbolKey(second));
  });
});

describe("mergeWorkspaceSymbolResults", () => {
  it("deduplicates overlapping workspace results without dropping collocated symbols", () => {
    const first = createSymbol("first");
    const second = createSymbol("second");

    expect(mergeWorkspaceSymbolResults([[first, second], [first]])).toEqual([first, second]);
  });

  it("keeps symbols from different files", () => {
    const first = createSymbol("shared");
    const second = createSymbol("shared", {
      filePath: "/repo/src/other.ts",
    });

    expect(mergeWorkspaceSymbolResults([[first], [second]])).toEqual([first, second]);
  });
});

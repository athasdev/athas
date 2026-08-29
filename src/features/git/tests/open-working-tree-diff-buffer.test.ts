import { describe, expect, it } from "vitest";
import { getWorkingTreeDiffEntries } from "../utils/open-working-tree-diff-buffer";

describe("working tree review entries", () => {
  const files = [
    { path: "src/app.tsx", status: "modified" as const, staged: false },
    { path: "src/app.tsx", status: "modified" as const, staged: true },
    { path: "src/new.ts", status: "untracked" as const, staged: false },
  ];

  it("keeps staged and unstaged changes distinct while skipping untracked files", () => {
    expect(getWorkingTreeDiffEntries(files, "all").map(([key]) => key)).toEqual([
      "unstaged:src/app.tsx",
      "staged:src/app.tsx",
    ]);
  });

  it("filters entries by review scope", () => {
    expect(getWorkingTreeDiffEntries(files, "staged").map(([key]) => key)).toEqual([
      "staged:src/app.tsx",
    ]);
    expect(getWorkingTreeDiffEntries(files, "unstaged").map(([key]) => key)).toEqual([
      "unstaged:src/app.tsx",
    ]);
  });
});

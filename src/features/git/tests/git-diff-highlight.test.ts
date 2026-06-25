import { describe, expect, test } from "vite-plus/test";
import { createLineBasedDiffTokenMap } from "../hooks/use-git-diff-highlight";
import type { GitDiffLine } from "../types/git.types";

describe("git diff highlighting", () => {
  test("creates line-based fallback tokens for TypeScript diff lines", () => {
    const lines: GitDiffLine[] = [
      {
        line_type: "context",
        content: 'import { value } from "./value";',
        old_line_number: 1,
        new_line_number: 1,
      },
      {
        line_type: "removed",
        content: "return value;",
        old_line_number: 2,
      },
      {
        line_type: "added",
        content: "return value + 1;",
        new_line_number: 2,
      },
    ];

    const tokenMap = createLineBasedDiffTokenMap(lines, "src/example.ts");

    expect(tokenMap.get(0)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "token-keyword" }),
        expect.objectContaining({ type: "token-string" }),
      ]),
    );
    expect(tokenMap.get(1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "token-keyword" })]),
    );
    expect(tokenMap.get(2)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "token-number" })]),
    );
  });
});

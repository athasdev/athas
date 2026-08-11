import { describe, expect, it } from "vite-plus/test";
import type { GitBlameLine } from "../types/git.types";
import { findGitBlameLine } from "../utils/git-blame-lines";

function createLine(lineNumber: number, totalLines: number, author: string): GitBlameLine {
  return {
    line_number: lineNumber,
    total_lines: totalLines,
    commit_hash: author,
    is_uncommitted: false,
    author,
    email: `${author}@example.com`,
    time: 1_700_000_000,
    commit: author,
  };
}

describe("findGitBlameLine", () => {
  const lines = [createLine(1, 3, "First"), createLine(4, 2, "Second"), createLine(6, 5, "Third")];

  it.each([
    [1, "First"],
    [3, "First"],
    [4, "Second"],
    [5, "Second"],
    [6, "Third"],
    [10, "Third"],
  ])("finds the hunk containing line %s", (lineNumber, author) => {
    expect(findGitBlameLine(lines, lineNumber)?.author).toBe(author);
  });

  it("returns null outside the blamed ranges", () => {
    expect(findGitBlameLine(lines, 0)).toBeNull();
    expect(findGitBlameLine(lines, 11)).toBeNull();
  });
});

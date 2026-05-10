import { describe, expect, it } from "vite-plus/test";
import type { GitDiffLine } from "@/features/git/types/git-types";
import {
  calculateInlineDiffHeight,
  getInlineDiffLinesToShow,
} from "../components/diff/inline-diff";

describe("inline diff view zone", () => {
  it("uses compact line-based height instead of a fixed panel height", () => {
    expect(calculateInlineDiffHeight(2, 20)).toBe(42);
  });

  it("caps height for long hunks", () => {
    expect(calculateInlineDiffHeight(12, 20)).toBe(162);
  });

  it("selects both removed and added lines for a modified line", () => {
    const lines: GitDiffLine[] = [
      { line_type: "context", content: "before", old_line_number: 4, new_line_number: 4 },
      { line_type: "removed", content: "old", old_line_number: 5 },
      { line_type: "added", content: "new", new_line_number: 5 },
      { line_type: "added", content: "other", new_line_number: 6 },
    ];

    expect(getInlineDiffLinesToShow(lines, 4, "modified")).toEqual([
      { line_type: "removed", content: "old", old_line_number: 5 },
      { line_type: "added", content: "new", new_line_number: 5 },
    ]);
  });
});

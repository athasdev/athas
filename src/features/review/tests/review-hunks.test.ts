import { describe, expect, it } from "vitest";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import { createReviewHunks } from "../lib/review-hunks";

function createMultiDiff(content = "return true;"): MultiFileDiff {
  return {
    repoPath: "/repo",
    commitHash: "abc123",
    totalFiles: 1,
    totalAdditions: 1,
    totalDeletions: 1,
    files: [
      {
        file_path: "src/session.ts",
        is_new: false,
        is_deleted: false,
        is_renamed: false,
        lines: [
          { line_type: "header", content: "@@ -8,3 +8,3 @@ function authorize() {" },
          { line_type: "removed", content: "return false;", old_line_number: 9 },
          { line_type: "added", content, new_line_number: 9 },
        ],
      },
    ],
  };
}

describe("review hunks", () => {
  it("creates a focused diff and deterministic fallback summary", () => {
    const [hunk] = createReviewHunks(createMultiDiff());

    expect(hunk.patch).toContain("-return false;");
    expect(hunk.patch).toContain("+return true;");
    expect(hunk.diff.lines).toHaveLength(3);
    expect(hunk.fallbackSummary).toEqual({
      title: "Updates function authorize()",
      description: "Replaces existing logic with a new implementation in this part of session.ts.",
    });
    expect(hunk.newStart).toBe(8);
    expect(hunk.context).toBe("function authorize() {");
  });

  it("keeps ids stable until hunk content changes", () => {
    expect(createReviewHunks(createMultiDiff())[0].id).toBe(
      createReviewHunks(createMultiDiff())[0].id,
    );
    expect(createReviewHunks(createMultiDiff())[0].id).not.toBe(
      createReviewHunks(createMultiDiff("return user.isAdmin;"))[0].id,
    );
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewHunkCard } from "../components/review-hunk-card";
import type { ReviewHunk } from "../lib/review-hunks";

vi.mock("@/features/git/hooks/use-git-diff-highlight", () => ({
  useDiffHighlighting: () => new Map(),
}));

const hunk: ReviewHunk = {
  id: "src/session.ts:one",
  filePath: "src/session.ts",
  fileKey: "src/session.ts",
  header: { line_type: "header", content: "@@ -8 +8 @@ function authorize() {" },
  lines: [
    { line_type: "removed", content: "return false;", old_line_number: 8 },
    { line_type: "added", content: "return user.isAdmin;", new_line_number: 8 },
  ],
  additions: 1,
  deletions: 1,
  newStart: 8,
  context: "function authorize() {",
  patch: "@@ -8 +8 @@ function authorize() {\n-return false;\n+return user.isAdmin;",
  fallbackSummary: {
    title: "Tightens admin authorization",
    description: "Requires an admin session before granting access.",
  },
  diff: {
    file_path: "src/session.ts",
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    lines: [
      { line_type: "header", content: "@@ -8 +8 @@ function authorize() {" },
      { line_type: "removed", content: "return false;", old_line_number: 8 },
      { line_type: "added", content: "return user.isAdmin;", new_line_number: 8 },
    ],
  },
};

describe("review hunk card", () => {
  it("keeps the description, source links, diff, and review action in one focused card", () => {
    const markup = renderToStaticMarkup(
      <ReviewHunkCard
        hunk={hunk}
        summary={hunk.fallbackSummary}
        current={1}
        total={4}
        isSummarizing={false}
        isReviewed={false}
        needsAttention={false}
        streak={0}
        activeInsightKind={null}
        insight={null}
        generatingInsightKind={null}
        hasPrevious={false}
        hasNext
        onOpenSource={() => {}}
        onOpenFullDiff={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
        onMarkReviewed={() => {}}
        onContinue={() => {}}
        onToggleAttention={() => {}}
        onRequestInsight={() => {}}
        onUpdateInsight={() => {}}
      />,
    );

    expect(markup).toContain("Tightens admin authorization");
    expect(markup).toContain("Requires an admin session before granting access.");
    expect(markup).not.toContain("Why it matters");
    expect(markup).toContain("src/session.ts:8");
    expect(markup).toContain("function authorize()");
    expect(markup).toContain("return false;");
    expect(markup).toContain("return user.isAdmin;");
    expect(markup).toContain("Full diff");
    expect(markup).toContain("Explain");
    expect(markup).toContain("Find risks");
    expect(markup).toContain("Suggest tests");
    expect(markup).toContain("Draft comment");
    expect(markup).toContain("Reviewed &amp; next");
  });
});

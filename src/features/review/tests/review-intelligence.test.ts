import { describe, expect, it } from "vitest";
import type { ReviewHunk } from "../lib/review-hunks";
import {
  createReviewSummaryBatches,
  parseReviewInsight,
  parseReviewSummaries,
} from "../services/review-intelligence";

function createHunk(id: string, patch: string): ReviewHunk {
  return {
    id,
    filePath: `src/${id}.ts`,
    fileKey: id,
    header: { line_type: "header", content: "@@ -1 +1 @@" },
    lines: [],
    additions: 1,
    deletions: 0,
    newStart: 1,
    context: null,
    patch,
    fallbackSummary: {
      title: "Updates file",
      description: "Introduces new behavior in this file.",
    },
    diff: {
      file_path: `src/${id}.ts`,
      is_new: false,
      is_deleted: false,
      is_renamed: false,
      lines: [],
    },
  };
}

describe("review intelligence", () => {
  it("accepts only requested summaries and normalizes their length", () => {
    const parsed = parseReviewSummaries(
      '```json\n{"summaries":[{"id":"one","title":"  Tightens   authorization  ","description":" Requires an active admin session before granting access. "},{"id":"other","title":"Ignore","description":"Ignore me"}]}\n```',
      new Set(["one"]),
    );

    expect(parsed).toEqual({
      one: {
        title: "Tightens authorization",
        description: "Requires an active admin session before granting access.",
      },
    });
  });

  it("keeps hosted requests inside the batch and input limits", () => {
    const batches = createReviewSummaryBatches(
      Array.from({ length: 8 }, (_, index) => createHunk(`hunk-${index}`, "+x".repeat(500))),
    );

    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.length <= 6)).toBe(true);
    expect(batches.every((batch) => JSON.stringify({ hunks: batch }).length <= 10_000)).toBe(true);
  });

  it("normalizes focused generative review results", () => {
    expect(
      parseReviewInsight(
        '{"title":"  Authorization risks ","items":[" Verify inactive sessions remain blocked. ","Check callers that previously received access."]}',
        "risks",
      ),
    ).toEqual({
      kind: "risks",
      title: "Authorization risks",
      items: [
        "Verify inactive sessions remain blocked.",
        "Check callers that previously received access.",
      ],
    });
  });
});

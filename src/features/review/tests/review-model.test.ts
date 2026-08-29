import { describe, expect, it } from "vitest";
import type { GitCommit, GitDiffStat, GitStatus } from "@/features/git/types/git.types";
import {
  classifyReviewRisk,
  createWorkingTreeFingerprint,
  EMPTY_PROJECT_REVIEW_STATE,
  getPendingCommits,
} from "../lib/review-model";

const commits: GitCommit[] = [
  { hash: "new", message: "Newest", author: "Agent", date: "2026-08-27T10:00:00Z" },
  { hash: "baseline", message: "Baseline", author: "Me", date: "2026-08-27T09:00:00Z" },
  { hash: "old", message: "Old", author: "Me", date: "2026-08-26T09:00:00Z" },
];

describe("review model", () => {
  it("queues commits newer than the saved review baseline", () => {
    expect(
      getPendingCommits({
        commits,
        ahead: 0,
        projectState: {
          ...EMPTY_PROJECT_REVIEW_STATE,
          reviewedThroughHash: "baseline",
        },
      }).map((commit) => commit.hash),
    ).toEqual(["new"]);
  });

  it("uses local ahead commits before a baseline exists", () => {
    expect(
      getPendingCommits({
        commits,
        ahead: 2,
        projectState: EMPTY_PROJECT_REVIEW_STATE,
      }).map((commit) => commit.hash),
    ).toEqual(["new", "baseline"]);
  });

  it("keeps a reviewed working tree dismissed until its shape changes", () => {
    const status: GitStatus = {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [{ path: "src/app.tsx", status: "modified", staged: false }],
    };
    const stats: GitDiffStat[] = [
      { file_path: "src/app.tsx", staged: false, additions: 4, deletions: 1 },
    ];

    const fingerprint = createWorkingTreeFingerprint(status, stats);
    expect(fingerprint).toBe(createWorkingTreeFingerprint(status, [...stats]));
    expect(
      createWorkingTreeFingerprint(status, [{ ...stats[0], additions: stats[0].additions + 1 }]),
    ).not.toBe(fingerprint);
  });

  it("raises attention for sensitive and broad changes", () => {
    expect(
      classifyReviewRisk([{ path: "src/features/auth/session.ts", additions: 12, deletions: 3 }])
        .level,
    ).toBe("high");
    expect(
      classifyReviewRisk([{ path: "src/ui/button.tsx", additions: 8, deletions: 2 }]).level,
    ).toBe("low");
  });
});

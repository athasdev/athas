import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { GitHubPRTabs } from "../components/github-pr-tabs";
import type { Commit } from "../types/github-pr-viewer.types";
import type { PullRequestDetails } from "../types/github.types";

const pr: PullRequestDetails = {
  number: 734,
  title: "Standardize Rust test validation",
  body: "",
  state: "open",
  author: { login: "mehmetozguldev" },
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
  isDraft: false,
  reviewDecision: null,
  url: "https://github.com/athasdev/athas/pull/734",
  headRef: "rust-test-standardization",
  baseRef: "main",
  additions: 1088,
  deletions: 955,
  changedFiles: 37,
  commits: [],
  statusChecks: [],
  linkedIssues: [],
  reviewRequests: [],
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  mergedAt: null,
  mergedBy: null,
  closedAt: null,
  reviews: [],
  labels: [],
  assignees: [],
};

const commits: Commit[] = [
  {
    oid: "a28ec85000000000000000000000000000000000",
    messageHeadline: "Standardize Rust test validation",
    messageBody: "Run formatting, checks, Clippy, and workspace tests.",
    authoredDate: "2026-08-08T00:00:00.000Z",
    authors: [{ login: "mehmetozguldev", name: "Mehmet", email: "mehmet@example.com" }],
  },
];

describe("GitHubPRTabs", () => {
  it("keeps commits between overview and changes", () => {
    const markup = renderToStaticMarkup(
      <GitHubPRTabs
        activeView="activity"
        commits={commits}
        repoPath="/repo"
        additions={pr.additions}
        deletions={pr.deletions}
        onShowOverview={vi.fn()}
        onShowChanges={vi.fn()}
      />,
    );

    const overviewIndex = markup.indexOf("Overview");
    const commitsIndex = markup.indexOf("Commits 1");
    const changesIndex = markup.indexOf("Changes");

    expect(overviewIndex).toBeGreaterThan(-1);
    expect(commitsIndex).toBeGreaterThan(overviewIndex);
    expect(changesIndex).toBeGreaterThan(commitsIndex);
    expect(markup).toContain("+1088");
    expect(markup).toContain("-955");
    expect(markup).toContain('aria-label="Show 1 commit"');
    expect(markup).toContain('aria-pressed="true"');
  });
});

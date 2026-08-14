import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { GitHubPRViewerHeader } from "../components/github-pr-viewer-header";
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

const actions = {
  onRefresh: vi.fn(),
  onCheckout: vi.fn(),
  onOpenInBrowser: vi.fn(),
  onCopyPRLink: vi.fn(),
  onCopyBranchName: vi.fn(),
  onShowOverview: vi.fn(),
  onShowFiles: vi.fn(),
  onComment: vi.fn(),
  onApprove: vi.fn(),
  onRequestChanges: vi.fn(),
  onMerge: vi.fn(),
  onClosePR: vi.fn(),
};

describe("GitHubPRViewerHeader", () => {
  it("keeps commits between overview and files in the top navigation", () => {
    const markup = renderToStaticMarkup(
      <GitHubPRViewerHeader
        pr={pr}
        activeView="activity"
        changedFilesCount={37}
        commits={commits}
        repoPath="/repo"
        additions={1088}
        deletions={955}
        isRefreshingDetails={false}
        {...actions}
      />,
    );

    const overviewIndex = markup.indexOf("Overview");
    const commitsIndex = markup.indexOf("Commits 1");
    const filesIndex = markup.indexOf("Files 37");

    expect(overviewIndex).toBeGreaterThan(-1);
    expect(commitsIndex).toBeGreaterThan(overviewIndex);
    expect(filesIndex).toBeGreaterThan(commitsIndex);
    expect(markup).toContain('aria-label="Show 1 commit"');
    expect(markup).toContain('aria-pressed="true"');
  });
});

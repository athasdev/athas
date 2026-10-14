// @vitest-environment jsdom
import { fireEvent } from "@testing-library/dom";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import type { IssueListItem } from "../types/github.types";
import { selectGitHubWorkSuggestions } from "../services/github-work-suggestions";
import { pullRequest } from "./github-view-fixtures";

const mocks = vi.hoisted(() => ({
  isAuthenticated: true,
  checkAuth: vi.fn(async () => {}),
  listPrs: vi.fn(),
  listIssues: vi.fn(),
}));

vi.mock("@/bindings/commands", () => ({
  commands: { githubListPrs: mocks.listPrs, githubListIssues: mocks.listIssues },
}));
vi.mock("../stores/github.store", () => ({
  useGitHubStore: {
    use: {
      isAuthenticated: () => mocks.isAuthenticated,
      actions: () => ({ checkAuth: mocks.checkAuth }),
    },
  },
}));

import { GitHubWorkSuggestions } from "../components/github-work-suggestions";

const issue = (number: number, extra: Partial<IssueListItem> = {}): IssueListItem => ({
  number,
  title: `Issue ${number}`,
  state: "OPEN",
  author: { login: "ada" },
  updatedAt: "2026-10-10T00:00:00Z",
  url: `https://github.com/athasdev/athas/issues/${number}`,
  labels: [],
  ...extra,
});

describe("selectGitHubWorkSuggestions", () => {
  it("offers the latest open pull requests, then issues, a few of each", () => {
    const items = selectGitHubWorkSuggestions(
      [
        pullRequest(1, { updatedAt: "2026-10-01T00:00:00Z" }),
        pullRequest(2, { updatedAt: "2026-10-09T00:00:00Z" }),
        pullRequest(3, { state: "MERGED", updatedAt: "2026-10-12T00:00:00Z" }),
        pullRequest(4, { updatedAt: "2026-10-05T00:00:00Z" }),
        pullRequest(5, { updatedAt: "2026-10-03T00:00:00Z" }),
      ],
      [issue(10, { state: "CLOSED" }), issue(11), issue(12, { updatedAt: "2026-10-11T00:00:00Z" })],
    );

    expect(items.map((item) => `${item.kind}:${item.number}`)).toEqual([
      "pull-request:2",
      "pull-request:4",
      "issue:12",
      "issue:11",
    ]);
    expect(items[0]).toMatchObject({ headRef: "feature-2", baseRef: "main" });
  });
});

describe("GitHubWorkSuggestions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  const onStart = vi.fn();

  const render = async (repoPath: string | null) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <GitHubWorkSuggestions repoPath={repoPath} onStart={onStart} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    mocks.isAuthenticated = true;
    mocks.listPrs.mockResolvedValue([pullRequest(7)]);
    mocks.listIssues.mockResolvedValue([issue(42)]);
    client = createTestQueryClient();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("lists the repository's open work and starts an agent on the one picked", async () => {
    await render("/repo");

    expect(mocks.listPrs).toHaveBeenCalledWith("/repo", "all");
    expect(mocks.listIssues).toHaveBeenCalledWith("/repo", "open");
    const issueButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Start an agent on issue #42: Issue 42"]',
    );
    expect(container.textContent).toContain("Pull request 7");
    expect(issueButton).not.toBeNull();

    fireEvent.click(issueButton!);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ kind: "issue", number: 42 }));
  });

  it("stays out of the way without GitHub access or a repository", async () => {
    mocks.isAuthenticated = false;
    await render("/repo");
    expect(container.innerHTML).toBe("");
    expect(mocks.listPrs).not.toHaveBeenCalled();

    mocks.isAuthenticated = true;
    await render(null);
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing when GitHub has no open work", async () => {
    mocks.listPrs.mockResolvedValue([]);
    mocks.listIssues.mockRejectedValue(new Error("rate limited"));
    await render("/repo");
    expect(container.innerHTML).toBe("");
  });
});

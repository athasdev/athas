// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { runPaneCommand } from "@/features/layout/services/pane-commands";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import { pullRequest, workflowRun } from "./github-view-fixtures";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  });
});

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  openUrl: vi.fn(async () => {}),
  openDetached: vi.fn(async () => {}),
  clipboard: [] as string[],
  pickDirectory: vi.fn(async (): Promise<string | null> => null),
  discoverRepos: vi.fn(async () => ["/repo"]),
  activeBufferId: null as string | null,
  buffer: {
    openPRBuffer: vi.fn(),
    openGitHubFormBuffer: vi.fn(),
    openGitHubActionBuffer: vi.fn(),
    openGitHubIssueBuffer: vi.fn(),
    openContent: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/window/detached/services/detached-resource-service", () => ({
  openResourceInDetachedWindow: mocks.openDetached,
}));
vi.mock("@/features/github/services/github-token-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/github/services/github-token-service")>()),
  syncGitHubTokenFromAccount: vi.fn(async () => ({ status: "notConnected" })),
}));
vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: async (text: string) => {
    mocks.clipboard.push(text);
  },
}));
vi.mock("@/utils/file-dialogs", () => ({ pickDirectory: mocks.pickDirectory }));
vi.mock("@/features/panes/hooks/use-pane-buffer-state", () => ({
  useActiveBufferId: () => mocks.activeBufferId,
}));
vi.mock("@/features/git/api/git-repo-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/git/api/git-repo-api")>()),
  discoverWorkspaceRepositories: mocks.discoverRepos,
}));
vi.mock("@/features/editor/stores/buffer.store", async () => {
  const { create } = await import("zustand");
  const { createSelectors } = await import("@/utils/zustand-selectors");
  return {
    useBufferStore: createSelectors(
      create(() => ({ buffers: [] as unknown[], actions: mocks.buffer })),
    ),
  };
});
vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create } = await import("zustand");
  const { defaultSettings } = await import("@/features/settings/config/default-settings");
  return {
    useSettingsStore: create(() => ({
      settings: { ...defaultSettings },
      actions: { updateSetting: vi.fn() },
    })),
  };
});

const { default: GitHubPRsView } = await import("../components/github-prs-view");
const { useSettingsStore } = await import("@/features/settings/stores/settings.store");
const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
const { defaultSettings } = await import("@/features/settings/config/default-settings");
const { useProjectStore } = await import("@/features/workspace/stores/project.store");
const { useRepositoryStore } = await import("@/features/git/stores/git-repository.store");
const { clearRepositoryDiscoveryCache } = await import("@/features/git/api/git-repo-api");
const { useSidebarStore } = await import("@/features/layout/stores/sidebar.store");
const { useGitHubStore } = await import("../stores/github.store");
const { useGitHubActionsStore } = await import("../stores/github-actions.store");

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;

function calls(command: string) {
  return mockInvoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown> | undefined);
}

let client: QueryClient;
let root: Root;
let host: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GitHubPRsView />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const view = () => within(host);

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

async function typeInto(input: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  await settle();
}

function menuItem(label: string) {
  const item = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
    ),
  ].find((element) => element.textContent?.trim() === label);
  if (!item) throw new Error(`menu item ${label} not found`);
  return item;
}

async function contextMenu(element: HTMLElement) {
  await act(async () => {
    fireEvent.contextMenu(element, { clientX: 10, clientY: 10 });
  });
  await settle();
}

const tab = (label: string) =>
  within(view().getByRole("navigation", { name: "GitHub sections" })).getByRole("button", {
    name: label,
  });

const rowFor = (title: string) => view().getByText(title).closest("[draggable]") as HTMLElement;

async function chooseFilter(current: string, next: string) {
  await click(view().getByRole("button", { name: `Filter: ${current}` }));
  await click(menuItem(next));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  clearRepositoryDiscoveryCache();
  useGitHubStore.getState().actions.reset();
  useSettingsStore.setState({ settings: { ...defaultSettings } } as never);
  useBufferStore.setState({ buffers: [] });
  useProjectStore.setState({ rootFolderPath: "/repo" });
  useSidebarStore.getState().actions.setGitHubSection("pull-requests");
  for (const fn of [
    ...Object.values(mocks.toast),
    ...Object.values(mocks.buffer),
    mocks.openUrl,
    mocks.openDetached,
  ]) {
    fn.mockReset();
  }
  mocks.pickDirectory.mockReset();
  mocks.pickDirectory.mockResolvedValue(null);
  mocks.discoverRepos.mockReset();
  mocks.discoverRepos.mockResolvedValue(["/repo"]);
  mocks.clipboard = [];
  mocks.activeBufferId = null;
  handlers = {
    github_check_auth: () => "authenticated",
    github_get_current_user: () => "ada",
    git_discover_repo: ({ path }) => (path.startsWith("/repo") ? "/repo" : null),
    git_status: () => ({ branch: "feature/sidebar", files: [], ahead: 0, behind: 0 }),
    github_list_prs: ({ filter }) =>
      filter === "review-requests"
        ? [pullRequest(9, { title: "Needs your eyes" })]
        : [
            pullRequest(1, { title: "Fix the parser", reviewDecision: "APPROVED" }),
            pullRequest(2, { title: "Add a sidebar", reviewDecision: "CHANGES_REQUESTED" }),
            pullRequest(3, { title: "Draft refactor", isDraft: true }),
          ],
    github_get_pr_details: ({ prNumber }) => pullRequest(prNumber),
    github_list_issues: () => [
      {
        number: 11,
        title: "Crash on save",
        state: "OPEN",
        author: { login: "ada" },
        updatedAt: "2026-10-10T00:00:00Z",
        url: "https://github.com/athasdev/athas/issues/11",
        labels: [],
      },
    ],
    github_list_workflow_runs: () => [
      workflowRun(101, { displayTitle: "Release build", status: "in_progress", conclusion: null }),
      workflowRun(102, { displayTitle: "Nightly tests", conclusion: "failure", runAttempt: 2 }),
      workflowRun(103, { displayTitle: "Docs deploy", event: "workflow_dispatch" }),
    ],
    github_get_workflow_run_details: ({ runId }) => ({ ...workflowRun(runId), jobs: [] }),
    github_list_releases: () => [],
    github_list_deployments: () => [],
    github_checkout_pr: () => null,
    github_rerun_workflow_run: () => null,
    github_cancel_workflow_run: () => null,
  };
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (command, args) => {
    const handler = handlers[command];
    return handler ? handler((args ?? {}) as Record<string, any>) : null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  client = createTestQueryClient();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GitHub sidebar", () => {
  it("asks the user to connect GitHub when signed out", async () => {
    handlers.github_check_auth = () => "notAuthenticated";
    await render();

    expect(view().queryByText("GitHub", { exact: true })).toBeNull();
    expect(view().queryByRole("navigation", { name: "GitHub sections" })).toBeNull();
    expect(calls("github_list_prs")).toEqual([]);
  });

  describe("pull requests", () => {
    it("lists open and draft pull requests for the current repository", async () => {
      await render();

      expect(tab("PRs").title).toBe("PRs (3)");
      expect(view().getByText("repo")).toBeTruthy();
      expect(view().getByText("/ feature/sidebar")).toBeTruthy();
      expect(view().getByText("Open")).toBeTruthy();
      expect(view().getByText("Drafts")).toBeTruthy();
      expect(view().getByText("#1 · ada")).toBeTruthy();
      expect(calls("github_list_prs")).toEqual([{ repoPath: "/repo", filter: "all" }]);
    });

    it("opens a pull request, its changes view and a new window", async () => {
      await render();

      await click(rowFor("Fix the parser"));
      expect(mocks.buffer.openPRBuffer).toHaveBeenCalledWith(1, {
        title: "Fix the parser",
        repoPath: "/repo",
        authorAvatarUrl: expect.any(String),
      });

      await click(
        within(rowFor("Add a sidebar")).getByRole("button", { name: "Open in new window" }),
      );
      expect(mocks.openDetached).toHaveBeenCalledWith(
        expect.objectContaining({ type: "pullRequest", prNumber: 2, name: "Add a sidebar" }),
        "/repo",
      );

      await act(async () => {
        fireEvent.doubleClick(rowFor("Draft refactor"));
      });
      expect(mocks.openDetached).toHaveBeenLastCalledWith(
        expect.objectContaining({ prNumber: 3 }),
        "/repo",
      );
    });

    it("prefetches details when a row is hovered", async () => {
      await render();

      await act(async () => {
        fireEvent.mouseOver(rowFor("Add a sidebar"));
      });
      await settle();

      expect(calls("github_get_pr_details")).toContainEqual({ repoPath: "/repo", prNumber: 2 });
    });

    it("filters pull requests by text", async () => {
      await render();

      await typeInto(view().getByPlaceholderText("Filter pull requests"), "draft");
      expect(view().queryByText("Fix the parser")).toBeNull();
      expect(view().getByText("Draft refactor")).toBeTruthy();

      await typeInto(view().getByPlaceholderText("Filter pull requests"), "#2");
      expect(view().getByText("Add a sidebar")).toBeTruthy();

      await typeInto(view().getByPlaceholderText("Filter pull requests"), "nothing like this");
      expect(view().getByText("No matching pull requests")).toBeTruthy();
    });

    it("switches the pull request filter", async () => {
      await render();

      await chooseFilter("Open PRs", "Review Requests");

      expect(calls("github_list_prs")).toContainEqual({
        repoPath: "/repo",
        filter: "review-requests",
      });
      expect(view().getByText("Review requested")).toBeTruthy();
      expect(view().getByText("Needs your eyes")).toBeTruthy();
      expect(useGitHubStore.getState().currentFilter).toBe("review-requests");
      expect(view().getByRole("button", { name: "Filter: Review Requests" })).toBeTruthy();
    });

    it("exposes the active filter as a checked menu item", async () => {
      await render();

      await click(view().getByRole("button", { name: "Filter: Open PRs" }));

      const options = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].map(
        (option) => [option.textContent?.trim(), option.getAttribute("aria-checked")],
      );
      expect(options).toContainEqual(["Open PRs", "true"]);
      expect(options).toContainEqual(["Review Requests", "false"]);
    });

    it("acts on a pull request from its context menu", async () => {
      await render();

      await contextMenu(rowFor("Fix the parser"));
      await click(menuItem("Open PR"));
      expect(mocks.buffer.openPRBuffer).toHaveBeenCalledWith(1, expect.anything());

      await contextMenu(rowFor("Fix the parser"));
      await click(menuItem("Open in New Window"));
      expect(mocks.openDetached).toHaveBeenCalled();

      await contextMenu(rowFor("Fix the parser"));
      await click(menuItem("Open on GitHub"));
      await vi.waitFor(() =>
        expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/athasdev/athas/pull/1"),
      );

      await contextMenu(rowFor("Fix the parser"));
      await click(menuItem("Checkout Branch"));
      expect(calls("github_checkout_pr")).toEqual([{ repoPath: "/repo", prNumber: 1 }]);

      await contextMenu(rowFor("Fix the parser"));
      await click(menuItem("Copy Title"));
      expect(mocks.clipboard).toEqual(["Fix the parser"]);
    });

    it("creates a pull request from the current branch", async () => {
      await render();

      await click(view().getByRole("button", { name: "New pull request" }));

      expect(mocks.buffer.openGitHubFormBuffer).toHaveBeenCalledWith({
        repoPath: "/repo",
        formKind: "pull-request",
        defaultHead: "feature/sidebar",
      });
    });

    it("shows an empty list", async () => {
      handlers.github_list_prs = () => [];
      await render();

      expect(view().getByText("No pull requests")).toBeTruthy();
    });

    it("shows a failed load and retries it", async () => {
      handlers.github_list_prs = () => {
        throw new Error("rate limited");
      };
      await render();

      expect(view().getByText("rate limited")).toBeTruthy();
      handlers.github_list_prs = () => [pullRequest(4, { title: "Back again" })];
      await click(view().getByRole("button", { name: "Try again" }));

      expect(view().getByText("Back again")).toBeTruthy();
    });

    it("offers to browse when the folder is not a repository", async () => {
      handlers.github_list_prs = ({ repoPath }) => {
        if (repoPath === "/repo") throw new Error("fatal: not a git repository");
        return [pullRequest(5, { title: "From the other repository" })];
      };
      handlers.git_discover_repo = ({ path }) =>
        path.startsWith("/other") ? "/other" : path.startsWith("/repo") ? "/repo" : null;
      mocks.pickDirectory.mockResolvedValue("/other/src");
      await render();

      expect(view().getByText("Not a Git repository")).toBeTruthy();
      expect(view().getByText("Select a folder that contains a .git repository.")).toBeTruthy();
      await click(view().getByRole("button", { name: "Browse Repository" }));

      expect(useRepositoryStore.getState().activeRepoPath).toBe("/other");
      expect(view().getByText("From the other repository")).toBeTruthy();
    });

    it("explains when the browsed folder is not inside a repository", async () => {
      handlers.github_list_prs = () => {
        throw new Error("fatal: not a git repository");
      };
      mocks.pickDirectory.mockResolvedValue("/elsewhere");
      await render();

      await click(view().getByRole("button", { name: "Browse Repository" }));

      expect(view().getByText("Not a Git repository")).toBeTruthy();
      expect(view().getByText("Selected folder is not inside a Git repository.")).toBeTruthy();
    });

    it("explains a failed browse when no folder is open", async () => {
      useProjectStore.setState({ rootFolderPath: undefined });
      mocks.discoverRepos.mockResolvedValue([]);
      mocks.pickDirectory.mockResolvedValue("/elsewhere");
      await render();

      await click(view().getByRole("button", { name: "Browse Repository" }));

      expect(view().getByText("No repository selected")).toBeTruthy();
      expect(view().getByText("Selected folder is not inside a Git repository.")).toBeTruthy();
    });

    it("asks for a repository when no folder is open", async () => {
      useProjectStore.setState({ rootFolderPath: undefined });
      mocks.discoverRepos.mockResolvedValue([]);
      mocks.pickDirectory.mockResolvedValue("/repo/sub");
      await render();

      expect(view().getByText("No repository selected")).toBeTruthy();
      expect(view().getByText("No repository")).toBeTruthy();
      await click(view().getByRole("button", { name: "Browse Repository" }));

      expect(useRepositoryStore.getState().activeRepoPath).toBe("/repo");
    });

    it("refreshes and switches repositories from the header", async () => {
      mocks.discoverRepos.mockResolvedValue(["/repo", "/repo/packages/web"]);
      handlers.git_discover_repo = ({ path }) =>
        path.startsWith("/repo/packages/web")
          ? "/repo/packages/web"
          : path.startsWith("/repo")
            ? "/repo"
            : null;
      await render();
      const before = calls("github_list_prs").length;

      await click(view().getByRole("button", { name: "Refresh" }));
      expect(calls("github_list_prs").length).toBeGreaterThan(before);

      await click(view().getByTitle(/Switch repository/));
      await click(menuItem("web"));
      expect(useRepositoryStore.getState().activeRepoPath).toBe("/repo/packages/web");
      expect(calls("github_list_prs")).toContainEqual({
        repoPath: "/repo/packages/web",
        filter: "all",
      });
    });

    it("refreshes from the section context menu and browses for a repository", async () => {
      await render();
      const before = calls("github_list_prs").length;

      await contextMenu(view().getByRole("navigation", { name: "GitHub sections" }));
      await click(menuItem("Refresh Pull Requests"));
      expect(calls("github_list_prs").length).toBeGreaterThan(before);

      mocks.pickDirectory.mockRejectedValue(new Error("dialog closed"));
      await contextMenu(view().getByRole("navigation", { name: "GitHub sections" }));
      await click(menuItem("Browse Repository"));
      expect(mocks.pickDirectory).toHaveBeenCalled();
    });
  });

  describe("sections", () => {
    it("shows nothing when every section is turned off", async () => {
      useSettingsStore.setState({
        settings: {
          ...defaultSettings,
          showGitHubPullRequests: false,
          showGitHubIssues: false,
          showGitHubActions: false,
          showGitHubReleases: false,
          showGitHubDeployments: false,
        },
      } as never);
      await render();

      expect(view().getByText("No GitHub sections enabled")).toBeTruthy();
    });

    it("falls back to the first enabled section", async () => {
      useSettingsStore.setState({
        settings: { ...defaultSettings, showGitHubPullRequests: false },
      } as never);
      await render();

      expect(useSidebarStore.getState().githubSection).toBe("issues");
      expect(view().getByText("Crash on save")).toBeTruthy();
    });

    it("lists issues and creates a new one", async () => {
      await render();

      await click(tab("Issues"));
      expect(view().getByText("Crash on save")).toBeTruthy();

      await chooseFilter("Open Issues", "Closed Issues");
      expect(calls("github_list_issues")).toContainEqual({ repoPath: "/repo", state: "closed" });

      await click(view().getByRole("button", { name: "New issue" }));
      expect(mocks.buffer.openGitHubFormBuffer).toHaveBeenCalledWith(
        expect.objectContaining({ formKind: "issue" }),
      );
    });

    it("switches sections from the command palette and refreshes them", async () => {
      await render();

      await act(async () =>
        runPaneCommand("view:github-prs", "action", { type: "show-section", section: "issues" }),
      );
      await settle();
      expect(view().getByPlaceholderText("Filter issues")).toBeTruthy();

      const before = calls("github_list_issues").length;
      await act(async () => runPaneCommand("view:github-prs", "action", { type: "refresh" }));
      await settle();
      expect(calls("github_list_issues").length).toBeGreaterThan(before);
    });

    it("opens releases and deployments", async () => {
      await render();

      await click(tab("Releases"));
      expect(view().getByText("No releases yet")).toBeTruthy();
      await click(view().getByRole("button", { name: "New release" }));
      expect(mocks.buffer.openContent).toHaveBeenCalledWith({
        type: "githubDelivery",
        kind: "releases",
        repoPath: "/repo",
      });

      await click(tab("Deployments"));
      expect(view().getByText("No deployments yet")).toBeTruthy();
      expect(view().queryByRole("button", { name: /New / })).toBeNull();
      await contextMenu(view().getByRole("navigation", { name: "GitHub sections" }));
      expect(() => menuItem("Refresh Deployments")).not.toThrow();
    });
  });

  describe("workflow runs", () => {
    async function openActions() {
      await render();
      await click(tab("Actions"));
    }

    it("lists runs with their state and opens one", async () => {
      await openActions();

      expect(view().getByText("Release build")).toBeTruthy();
      expect(view().getByText("Failed · main")).toBeTruthy();

      await click(rowFor("Docs deploy"));
      expect(mocks.buffer.openGitHubActionBuffer).toHaveBeenCalledWith({
        runId: 103,
        repoPath: "/repo",
        title: "Docs deploy",
        url: "https://github.com/athasdev/athas/actions/runs/103",
      });

      await click(
        within(rowFor("Docs deploy")).getByRole("button", { name: "Open in new window" }),
      );
      expect(mocks.openDetached).toHaveBeenCalledWith(
        expect.objectContaining({ type: "githubAction", runId: 103 }),
        "/repo",
      );
    });

    it("filters runs by state and text", async () => {
      await openActions();

      await chooseFilter("All Runs", "Failed");
      expect(view().getByText("Nightly tests")).toBeTruthy();
      expect(view().queryByText("Docs deploy")).toBeNull();

      await chooseFilter("Failed", "In Progress");
      expect(view().getByText("Release build")).toBeTruthy();
      expect(view().queryByText("Nightly tests")).toBeNull();

      await chooseFilter("In Progress", "Successful");
      expect(view().getByText("Docs deploy")).toBeTruthy();

      await chooseFilter("Successful", "All Runs");
      await typeInto(view().getByPlaceholderText("Filter actions"), "workflow_dispatch");
      expect(view().getByText("Docs deploy")).toBeTruthy();
      expect(view().queryByText("Release build")).toBeNull();

      await typeInto(view().getByPlaceholderText("Filter actions"), "zzz");
      expect(view().getByText("No matching workflow runs")).toBeTruthy();
    });

    it("cancels an active run and re-runs failed ones from the context menu", async () => {
      await openActions();

      await contextMenu(rowFor("Release build"));
      expect(() => menuItem("Re-run All Jobs")).toThrow();
      await click(menuItem("Cancel Run"));
      expect(calls("github_cancel_workflow_run")).toEqual([{ repoPath: "/repo", runId: 101 }]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Cancellation requested");

      await contextMenu(rowFor("Nightly tests"));
      await click(menuItem("Re-run Failed Jobs"));
      expect(calls("github_rerun_workflow_run")).toEqual([
        { repoPath: "/repo", runId: 102, failedJobsOnly: true },
      ]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Re-run of failed jobs queued");

      handlers.github_rerun_workflow_run = () => {
        throw new Error("forbidden");
      };
      await contextMenu(rowFor("Docs deploy"));
      expect(() => menuItem("Re-run Failed Jobs")).toThrow();
      await click(menuItem("Re-run All Jobs"));
      expect(mocks.toast.error).toHaveBeenCalledWith("forbidden");
    });

    it("copies and opens runs from the context menu", async () => {
      await openActions();

      await contextMenu(rowFor("Docs deploy"));
      await click(menuItem("Copy Link"));
      await contextMenu(rowFor("Docs deploy"));
      await click(menuItem("Copy Title"));
      expect(mocks.clipboard).toEqual([
        "https://github.com/athasdev/athas/actions/runs/103",
        "Docs deploy",
      ]);

      await contextMenu(rowFor("Docs deploy"));
      await click(menuItem("Open on GitHub"));
      await contextMenu(rowFor("Docs deploy"));
      await click(menuItem("Open Run"));
      expect(mocks.buffer.openGitHubActionBuffer).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 103 }),
      );
    });

    it("shows a spinner on a run with a pending action", async () => {
      await openActions();

      await act(async () => {
        useGitHubActionsStore.getState().actions.setPendingAction(103, "cancel");
      });

      expect(
        within(rowFor("Docs deploy")).getByRole("status", { name: "Cancelling" }),
      ).toBeTruthy();
    });

    it("shows empty and failed run lists", async () => {
      handlers.github_list_workflow_runs = () => [];
      await openActions();
      expect(view().getByText("No workflow runs yet")).toBeTruthy();

      await act(async () => root.unmount());
      client.clear();
      root = createRoot(host);
      handlers.github_list_workflow_runs = () => {
        throw new Error("actions disabled");
      };
      await render();
      expect(view().getByText("actions disabled")).toBeTruthy();

      handlers.github_list_workflow_runs = () => [workflowRun(5, { displayTitle: "Recovered" })];
      await click(view().getByRole("button", { name: "Retry" }));
      expect(view().getByText("Recovered")).toBeTruthy();
    });

    it("runs a workflow from the actions toolbar", async () => {
      await openActions();

      await click(view().getByRole("button", { name: "Run workflow" }));

      expect(mocks.buffer.openGitHubFormBuffer).toHaveBeenCalledWith(
        expect.objectContaining({ formKind: "action" }),
      );
    });
  });
});

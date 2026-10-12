// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import type { GitWorktree } from "../types/git.types";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const git = vi.hoisted(() => ({
  getBranches: vi.fn(),
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  getWorktrees: vi.fn(),
  addWorktree: vi.fn(),
  createStash: vi.fn(),
  resolveRepositoryPath: vi.fn(),
  discoverWorkspaceRepositories: vi.fn(),
  pickDirectory: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  clipboard: [] as string[],
  toasts: [] as Array<{
    message: string;
    type: string;
    action?: { label: string; onClick: () => Promise<void> | void };
  }>,
}));

vi.mock("../api/git-branches-api", () => ({
  getBranches: git.getBranches,
  checkoutBranch: git.checkoutBranch,
  createBranch: git.createBranch,
  deleteBranch: git.deleteBranch,
}));
vi.mock("../api/git-worktrees-api", () => ({
  getWorktrees: git.getWorktrees,
  addWorktree: git.addWorktree,
}));
vi.mock("../api/git-stash-api", () => ({ createStash: git.createStash }));
vi.mock("../api/git-repo-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/git-repo-api")>()),
  resolveRepositoryPath: git.resolveRepositoryPath,
  discoverWorkspaceRepositories: git.discoverWorkspaceRepositories,
}));
vi.mock("@/utils/file-dialogs", () => ({ pickDirectory: git.pickDirectory }));
vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: async (text: string) => {
    git.clipboard.push(text);
  },
}));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showConfirmDialog: git.confirm,
  showPromptDialog: git.prompt,
}));
vi.mock("@/utils/toast", () => ({
  useToast: () => ({
    showToast: (toast: (typeof git.toasts)[number]) => {
      git.toasts.push(toast);
      return "toast";
    },
  }),
}));

const { default: GitBranchManager } = await import("../components/git-branch-manager");
const { useRepositoryStore } = await import("../stores/git-repository.store");

const worktree = (path: string, branch: string | null, extra: Partial<GitWorktree> = {}) => ({
  path,
  branch,
  head: "abcdef1234",
  is_bare: false,
  is_detached: branch === null,
  is_current: false,
  ...extra,
});

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
const callbacks = {
  onBranchChange: vi.fn(),
  onWorktreeChange: vi.fn(),
  onRepositoryChange: vi.fn(),
};

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(props: Partial<Parameters<typeof GitBranchManager>[0]> = {}) {
  await act(async () =>
    root.render(
      <GitBranchManager currentBranch="main" repoPath="/repo" {...callbacks} {...props} />,
    ),
  );
}

const body = () => within(document.body);

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

async function openSelector() {
  await click(body().getByRole("button", { name: /Switch repository or branch/ }));
}

const searchInput = () =>
  body().getByPlaceholderText(/^Search branches|^Search worktrees|^Filter repositories/);

async function search(value: string) {
  await act(async () => {
    fireEvent.change(searchInput(), { target: { value } });
  });
}

async function pressInSearch(key: string) {
  await act(async () => {
    fireEvent.keyDown(searchInput(), { key });
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  for (const fn of Object.values(git)) if (typeof fn === "function") fn.mockReset();
  for (const fn of Object.values(callbacks)) fn.mockReset();
  git.clipboard.length = 0;
  git.toasts.length = 0;
  git.getBranches.mockResolvedValue(["main", "feature/login", "fix/crash"]);
  git.getWorktrees.mockResolvedValue([
    worktree("/repo", "main"),
    worktree("/work/login", "feature/login"),
    worktree("/work/stale", "old", { prunable_reason: "gitdir missing" }),
    worktree("/work/detached", null),
  ]);
  git.discoverWorkspaceRepositories.mockResolvedValue([]);
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("git branch manager", () => {
  it("renders nothing without a current branch", async () => {
    await render({ currentBranch: undefined });
    expect(container.innerHTML).toBe("");
  });

  it("switches to another branch from the selector", async () => {
    git.checkoutBranch.mockResolvedValue({ success: true, hasChanges: false, message: "" });
    await render();
    await openSelector();
    expect(body().getByText("3 branches")).toBeTruthy();
    expect(body().getByText("current")).toBeTruthy();

    await click(body().getByText("fix/crash"));
    expect(git.checkoutBranch).toHaveBeenCalledWith("/repo", "fix/crash");
    expect(callbacks.onBranchChange).toHaveBeenCalled();
    expect(body().queryByPlaceholderText("Search branches...")).toBeNull();
  });

  it("selects a branch with the keyboard and reports checkout errors", async () => {
    git.checkoutBranch.mockResolvedValue({
      success: false,
      hasChanges: false,
      message: "pathspec did not match",
    });
    await render();
    await openSelector();
    await search("crash");
    await pressInSearch("ArrowDown");
    await pressInSearch("ArrowUp");
    await pressInSearch("End");
    await pressInSearch("Home");
    await pressInSearch("ArrowDown");
    await pressInSearch("Enter");
    expect(git.checkoutBranch).toHaveBeenCalledWith("/repo", "fix/crash");
    expect(git.createBranch).not.toHaveBeenCalled();
    expect(last(git.toasts)).toMatchObject({ type: "error" });
  });

  it("offers to stash local changes before switching", async () => {
    git.checkoutBranch
      .mockResolvedValueOnce({ success: false, hasChanges: true, message: "You have changes" })
      .mockResolvedValueOnce({ success: true, hasChanges: false, message: "" });
    git.createStash.mockResolvedValue(true);
    await render();
    await openSelector();
    await click(body().getByText("feature/login"));

    const toast = last(git.toasts)!;
    expect(toast.message).toBe("You have changes");
    expect(toast.action?.label).toBe("Stash Changes");
    await act(async () => {
      await toast.action!.onClick();
    });
    expect(git.createStash).toHaveBeenCalledWith("/repo", "Switching to feature/login", true);
    expect(last(git.toasts)?.message).toBe("Changes stashed and branch switched successfully");
    expect(callbacks.onBranchChange).toHaveBeenCalled();
  });

  it("reports when stashing or switching after a stash fails", async () => {
    git.checkoutBranch.mockResolvedValue({
      success: false,
      hasChanges: true,
      message: "You have changes",
    });
    git.createStash.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("locked"));
    await render();
    await openSelector();
    await click(body().getByText("feature/login"));
    await act(async () => {
      await last(git.toasts)!.action!.onClick();
    });
    expect(last(git.toasts)?.message).toBe("Failed to switch branch after stashing");

    await act(async () => {
      await git.toasts[0].action!.onClick();
    });
    expect(last(git.toasts)?.message).toBe("Failed to stash changes");
  });

  it("creates a branch from the search text", async () => {
    git.createBranch.mockResolvedValue(true);
    await render();
    await openSelector();
    await search("feature/search");
    expect(body().getByText('Create new branch "feature/search"')).toBeTruthy();
    await click(body().getByRole("button", { name: /New Branch/ }));
    expect(git.createBranch).toHaveBeenCalledWith("/repo", "feature/search", "main");
    expect(callbacks.onBranchChange).toHaveBeenCalled();
  });

  it("deletes a branch only after confirmation", async () => {
    git.deleteBranch.mockResolvedValue(true);
    await render();
    await openSelector();

    git.confirm.mockResolvedValueOnce(false);
    await click(body().getByRole("button", { name: "Delete branch fix/crash" }));
    expect(git.deleteBranch).not.toHaveBeenCalled();

    git.confirm.mockResolvedValueOnce(true);
    git.getBranches.mockResolvedValue(["main", "feature/login"]);
    await click(body().getByRole("button", { name: "Delete branch fix/crash" }));
    expect(git.deleteBranch).toHaveBeenCalledWith("/repo", "fix/crash");
    expect(body().queryByText("fix/crash")).toBeNull();
    expect(body().getByText("2 branches")).toBeTruthy();
  });

  it("lists openable worktrees, switches to one and adds a new one", async () => {
    git.addWorktree.mockResolvedValue(true);
    await render();
    await openSelector();
    await click(body().getByRole("tab", { name: /Worktrees/ }));
    expect(body().getByText("4 worktrees")).toBeTruthy();
    expect(body().getByText("login")).toBeTruthy();
    expect(body().getByText("Detached HEAD")).toBeTruthy();
    expect(body().queryByText("stale")).toBeNull();

    await click(body().getByText("login"));
    expect(callbacks.onWorktreeChange).toHaveBeenCalledWith("/work/login");

    await openSelector();
    await click(body().getByRole("tab", { name: /Worktrees/ }));
    await search("/work/new");
    await click(body().getByText('Create worktree "/work/new"'));
    expect(git.addWorktree).toHaveBeenCalledWith("/repo", "/work/new");
    expect(callbacks.onWorktreeChange).toHaveBeenLastCalledWith("/work/new");

    await openSelector();
    await click(body().getByRole("tab", { name: /Worktrees/ }));
    await search("nothing-here-at-all");
    await search("");
    git.getWorktrees.mockResolvedValue([]);
    await click(last(body().getAllByRole("button", { name: /Refresh/ }))!);
    expect(body().getByText("No worktrees found")).toBeTruthy();
  });

  it("switches repositories and adds one from disk", async () => {
    useRepositoryStore.setState({
      activeRepoPath: "/repo",
      availableRepoPaths: ["/repo", "/repo/packages/api"],
    } as never);
    await render();
    await openSelector();
    await click(body().getByRole("tab", { name: /Repositories/ }));
    expect(body().getByText("2 repositories")).toBeTruthy();
    await click(body().getByText("api"));
    expect(callbacks.onRepositoryChange).toHaveBeenCalledWith("/repo/packages/api");
    expect(useRepositoryStore.getState().activeRepoPath).toBe("/repo/packages/api");

    await openSelector();
    await click(body().getByRole("tab", { name: /Repositories/ }));
    git.pickDirectory.mockResolvedValueOnce("/tmp/not-a-repo");
    git.resolveRepositoryPath.mockResolvedValueOnce(null);
    await click(body().getByRole("button", { name: /^Add$/ }));
    expect(body().getByText("Selected folder is not inside a Git repository.")).toBeTruthy();

    git.pickDirectory.mockResolvedValueOnce("/other/project/src");
    git.resolveRepositoryPath.mockResolvedValueOnce("/other/project");
    await click(body().getByRole("button", { name: /^Add$/ }));
    expect(callbacks.onRepositoryChange).toHaveBeenLastCalledWith("/other/project");
    expect(useRepositoryStore.getState().manualRepoPaths).toContain("/other/project");

    await openSelector();
    await click(body().getByRole("tab", { name: /Repositories/ }));
    expect(body().getAllByText("added").length).toBeGreaterThan(0);
    await click(body().getByRole("button", { name: "Clear Added" }));
    expect(useRepositoryStore.getState().manualRepoPaths).toEqual([]);
  });

  describe("branch menu", () => {
    it("switches, copies and creates branches from the compact menu", async () => {
      git.checkoutBranch.mockResolvedValue({ success: true, hasChanges: false, message: "" });
      git.createBranch.mockResolvedValue(true);
      await render({ triggerMode: "branch" });
      await click(body().getByRole("button", { name: "Switch branch. Current branch: main" }));
      const radios = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
      expect(radios().map((radio) => radio.textContent?.trim())).toEqual([
        "main",
        "feature/login",
        "fix/crash",
      ]);

      await act(async () => {
        fireEvent.change(body().getByPlaceholderText("Search branches"), {
          target: { value: "zzz" },
        });
      });
      expect(body().getByText("No branches match")).toBeTruthy();
      await act(async () => {
        fireEvent.change(body().getByPlaceholderText("Search branches"), {
          target: { value: "" },
        });
      });

      await click(radios()[2]);
      expect(git.checkoutBranch).toHaveBeenCalledWith("/repo", "fix/crash");

      await click(body().getByRole("button", { name: "Switch branch. Current branch: main" }));
      await click(body().getByRole("menuitem", { name: /More actions for feature\/login/ }));
      await click(body().getByRole("menuitem", { name: /Copy branch name/ }));
      expect(git.clipboard).toEqual(["feature/login"]);

      git.prompt.mockResolvedValueOnce("feature/login-v2");
      await click(body().getByRole("button", { name: "Switch branch. Current branch: main" }));
      await click(body().getByRole("menuitem", { name: /New branch…/ }));
      expect(git.prompt).toHaveBeenCalledWith(
        "Enter a name for the new branch.",
        expect.objectContaining({ title: "New Branch from main" }),
      );
      expect(git.createBranch).toHaveBeenCalledWith("/repo", "feature/login-v2", "main");
    });
  });
});

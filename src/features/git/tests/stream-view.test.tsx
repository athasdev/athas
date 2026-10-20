// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { runPaneCommand } from "@/features/layout/services/pane-commands";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";
import { invalidateGitDiffData } from "../api/git-diff-api";
import type { GitFile, GitWorktree } from "../types/git.types";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  confirm: vi.fn(async () => true),
  prompts: [] as Array<string | null>,
  alert: vi.fn(async () => {}),
  openBuffer: vi.fn(() => "buffer"),
  pickDirectory: vi.fn(async (): Promise<string | null> => null),
  openWorktree: vi.fn(async () => true),
  discoverRepos: vi.fn(async () => ["/repo"]),
  clipboard: [] as string[],
  activeBufferId: null as string | null,
  updateSetting: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showConfirmDialog: mocks.confirm,
  showPromptDialog: async () => mocks.prompts.shift() ?? null,
  showAlertDialog: mocks.alert,
}));
vi.mock("@/utils/file-dialogs", () => ({ pickDirectory: mocks.pickDirectory }));
vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: async (text: string) => {
    mocks.clipboard.push(text);
  },
}));
vi.mock("@/features/panes/hooks/use-pane-buffer-state", () => ({
  useActiveBufferId: () => mocks.activeBufferId,
}));
vi.mock("@/features/editor/stores/buffer.store", async () => {
  const { create } = await import("zustand");
  return {
    useBufferStore: create(() => ({
      buffers: [] as unknown[],
      actions: { openBuffer: mocks.openBuffer, updateBuffer: vi.fn() },
    })),
  };
});
vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create } = await import("zustand");
  return {
    useSettingsStore: create(() => ({
      settings: {},
      actions: { updateSetting: mocks.updateSetting },
    })),
  };
});
vi.mock("../services/git-worktree-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/git-worktree-open")>()),
  openGitWorktreeWorkspace: mocks.openWorktree,
}));
vi.mock("../api/git-repo-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/git-repo-api")>()),
  discoverWorkspaceRepositories: mocks.discoverRepos,
}));

const { default: StreamView } = await import("../stream/stream-view");
const { useSettingsStore } = await import("@/features/settings/stores/settings.store");
const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
const { useRepositoryStore } = await import("../stores/git-repository.store");
const { useGitStore } = await import("../stores/git.store");

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;
let statusFiles: GitFile[];
let statusExtras: Record<string, unknown>;

function calls(command: string) {
  return mockInvoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown> | undefined);
}

const worktree = (path: string, branch: string | null, extra: Partial<GitWorktree> = {}) => ({
  path,
  branch,
  head: "abcdef1234",
  is_bare: false,
  is_detached: branch === null,
  is_current: false,
  ...extra,
});

const commit = (index: number, extra: Record<string, unknown> = {}) => ({
  hash: `${index}`.repeat(8) + "abcdef",
  message: `Commit number ${index}`,
  author: index % 2 ? "Ada" : "Linus",
  email: `dev${index}@example.com`,
  date: "2026-10-01T00:00:00Z",
  ...extra,
});

let root: Root;
let host: HTMLDivElement;
const onFileSelect = vi.fn();

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(...args: [repoPath?: string]) {
  const repoPath = args.length > 0 ? args[0] : "/repo";
  await act(async () =>
    root.render(<StreamView repoPath={repoPath} onFileSelect={onFileSelect} isActive />),
  );
  await settle();
}

const view = () => within(host);
const body = () => within(document.body);

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

const row = (path: string, index = 0) =>
  view().getAllByTitle(path)[index] as HTMLElement & { title: string };

function titled(title: string) {
  const element = [...host.querySelectorAll<HTMLElement>("[title]")].find(
    (candidate) => candidate.title === title,
  );
  if (!element) throw new Error(`no element titled ${title}`);
  return element;
}

const rowButton = (path: string, label: string, index = 0) =>
  within(row(path, index)).getByRole("button", { name: label });

const tab = (label: string) =>
  within(view().getByRole("navigation", { name: "Source control sections" })).getByRole("button", {
    name: label,
  });

function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!item) throw new Error(`menu item ${label} not found`);
  return item;
}

async function openContextMenu(element: HTMLElement) {
  await act(async () => {
    fireEvent.contextMenu(element, { clientX: 10, clientY: 10 });
  });
  await settle();
}

const sectionHeader = (title: string) =>
  view()
    .getAllByText(title)
    .map((element) => element.closest("section > div > div"))
    .find(Boolean) as HTMLElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  clearRepositoryDiscoveryCache();
  invalidateGitDiffData();
  localStorage.clear();
  useSettingsStore.setState({
    settings: {
      showUntrackedFiles: true,
      openDiffOnClick: true,
      autoRefreshGitStatus: false,
      hiddenGitSidebarItems: [],
      confirmBeforeDiscard: true,
    },
  } as never);
  useBufferStore.setState({ buffers: [] });
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
  mocks.confirm.mockReset();
  mocks.confirm.mockResolvedValue(true);
  mocks.prompts = [];
  mocks.alert.mockClear();
  mocks.openBuffer.mockClear();
  mocks.pickDirectory.mockReset();
  mocks.pickDirectory.mockResolvedValue(null);
  mocks.openWorktree.mockReset();
  mocks.openWorktree.mockResolvedValue(true);
  mocks.discoverRepos.mockReset();
  mocks.discoverRepos.mockResolvedValue(["/repo"]);
  mocks.updateSetting.mockReset();
  mocks.clipboard = [];
  mocks.activeBufferId = null;
  onFileSelect.mockReset();
  statusFiles = [
    { path: "src/app.ts", status: "modified", staged: true },
    { path: "src/app.ts", status: "modified", staged: false },
    { path: "README.md", status: "modified", staged: false },
    { path: "old/gone.ts", status: "deleted", staged: false },
    { path: "notes/todo.txt", status: "untracked", staged: false },
  ];
  statusExtras = { ahead: 1, behind: 0 };
  handlers = {
    git_discover_repo: ({ path }) => (path.startsWith("/repo") ? "/repo" : null),
    git_status: () => ({ branch: "main", files: statusFiles, ...statusExtras }),
    git_log: () => [1, 2, 3, 4, 5, 6].map((index) => commit(index)),
    git_branches: () => ["main", "dev", "feature/login"],
    git_get_stashes: () => [{ index: 0, message: "On main: WIP parser", date: "2026-10-01" }],
    git_status_diff_stats: () => [
      { file_path: "src/app.ts", staged: true, additions: 3, deletions: 1 },
      { file_path: "README.md", staged: false, additions: 2, deletions: 0 },
    ],
    git_get_worktrees: () => [
      worktree("/repo", "main", { is_current: true }),
      worktree("/work/login", "feature/login", { locked_reason: "in use" }),
      worktree("/work/stale", "old", { prunable_reason: "gitdir missing" }),
      worktree("/work/detached", null),
    ],
    git_get_remotes: () => [
      { name: "origin", url: "git@github.com:athas/athas.git" },
      { name: "fork", url: "git@github.com:me/athas.git" },
    ],
    git_get_tags: () => [
      {
        name: "v2.0.0",
        commit: "2222222abc",
        message: "Second",
        date: "2026-09-01",
        is_annotated: true,
      },
      { name: "v1.0.0", commit: "1111111abc", message: null, date: "", is_annotated: false },
    ],
    git_checkout: () => ({ success: true, hasChanges: false, message: "" }),
    git_checkout_tag: () => ({ success: true, hasChanges: false, message: "" }),
    git_commit_diff: () => [{ file_path: "a.ts", lines: [] }],
    git_stash_diff: () => [{ file_path: "b.ts", lines: [] }],
    git_ref_diff: () => [{ file_path: "c.ts", lines: [] }],
    git_diff_file: ({ filePath }) => ({
      file_path: filePath,
      lines: [{ line_type: "added", content: "x" }],
      is_new: false,
      is_deleted: false,
      is_renamed: false,
    }),
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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("source control stream view", () => {
  describe("without a repository", () => {
    it("offers to browse for a repository and reports a folder outside git", async () => {
      handlers.git_discover_repo = () => null;
      mocks.discoverRepos.mockResolvedValue([]);
      mocks.pickDirectory.mockResolvedValue("/elsewhere");
      await render("/plain");

      expect(view().getByText("No repository selected")).toBeTruthy();
      await click(view().getByRole("button", { name: /Browse/ }));

      expect(mocks.alert).toHaveBeenCalledWith(
        "Selected folder is not inside a Git repository.",
        "Select Repository",
      );
      expect(view().getByText("Selected folder is not inside a Git repository.")).toBeTruthy();
    });

    it("selects a picked repository", async () => {
      handlers.git_discover_repo = ({ path }) => (path.startsWith("/picked") ? "/picked" : null);
      mocks.discoverRepos.mockResolvedValue([]);
      mocks.pickDirectory.mockResolvedValue("/picked/src");
      await render("/plain");

      await click(view().getByRole("button", { name: /Browse/ }));

      expect(useRepositoryStore.getState().activeRepoPath).toBe("/picked");
      expect(await view().findByTitle(/^\/picked\smain — switch branch$/)).toBeTruthy();
    });

    it("reports a failing directory picker", async () => {
      handlers.git_discover_repo = () => null;
      mocks.discoverRepos.mockResolvedValue([]);
      mocks.pickDirectory.mockRejectedValue(new Error("denied"));
      await render("/plain");

      await click(view().getByRole("button", { name: /Browse/ }));

      expect(mocks.alert).toHaveBeenCalledWith(
        "Failed to select repository:\nError: denied",
        "Select Repository",
      );
      expect(view().getByText("Failed to select repository")).toBeTruthy();
    });

    it("initializes a repository in the open folder", async () => {
      let initialized = false;
      handlers.git_discover_repo = ({ path }) =>
        initialized && path === "/plain" ? "/plain" : null;
      handlers.git_init = () => {
        initialized = true;
        return null;
      };
      mocks.discoverRepos.mockImplementation(async () => (initialized ? ["/plain"] : []));
      await render("/plain");

      await click(view().getByRole("button", { name: /Initialize/ }));

      expect(calls("git_init")).toEqual([{ repoPath: "/plain" }]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Repository initialized.");
      expect(useRepositoryStore.getState().activeRepoPath).toBe("/plain");
    });

    it("reports a failed initialization and refuses without an open folder", async () => {
      handlers.git_discover_repo = () => null;
      handlers.git_init = () => {
        throw new Error("read-only");
      };
      mocks.discoverRepos.mockResolvedValue([]);
      await render("/plain");

      await click(view().getByRole("button", { name: /Initialize/ }));
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to initialize repository.");
      expect(view().getByText("Failed to initialize repository.")).toBeTruthy();
    });

    it("refuses to initialize without an open folder", async () => {
      mocks.discoverRepos.mockResolvedValue([]);
      await render(undefined);

      expect(
        (view().getByRole("button", { name: /Initialize/ }) as HTMLButtonElement).disabled,
      ).toBe(true);
      await act(async () =>
        runPaneCommand("view:git", "action", { type: "initialize-repository" }),
      );
      await settle();
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Open a folder before initializing a repository.",
      );
      expect(calls("git_init")).toEqual([]);
    });
  });

  describe("changes", () => {
    it("lists staged and unstaged files with stats and stages from a row", async () => {
      await render();

      expect(view().getByTitle(/^\/repo\smain — switch branch$/)).toBeTruthy();
      expect(view().getByText("Staged")).toBeTruthy();
      expect(view().getByText("Changes", { selector: "section span" })).toBeTruthy();
      expect(view().getAllByTitle("src/app.ts")).toHaveLength(2);
      expect(within(row("README.md")).getByText("+2")).toBeTruthy();
      expect(within(row("notes/todo.txt")).queryByRole("button", { name: "Discard" })).toBeNull();

      await click(rowButton("README.md", "Stage"));
      expect(calls("git_add")).toEqual([{ repoPath: "/repo", filePath: "README.md" }]);

      await click(rowButton("src/app.ts", "Unstage"));
      expect(calls("git_reset")).toEqual([{ repoPath: "/repo", filePath: "src/app.ts" }]);
    });

    it("discards a single file after confirmation", async () => {
      await render();

      await click(rowButton("README.md", "Discard"));

      expect(mocks.confirm).toHaveBeenCalledWith(
        "Discard changes in README.md? This can't be undone.",
        expect.anything(),
      );
      expect(calls("git_discard_file_changes")).toEqual([
        { repoPath: "/repo", filePath: "README.md" },
      ]);
    });

    it("opens a diff when a row is clicked and a plain file for untracked rows", async () => {
      await render();

      await click(row("README.md"));
      await vi.waitFor(() => expect(mocks.openBuffer).toHaveBeenCalled());
      expect(calls("git_diff_file")).toEqual([
        { repoPath: "/repo", filePath: "README.md", staged: false },
      ]);

      await click(row("notes/todo.txt"));
      expect(onFileSelect).toHaveBeenCalledWith("/repo/notes/todo.txt", false);
    });

    it("runs the section bulk actions", async () => {
      await render();

      await click(view().getByRole("button", { name: "Stage all" }));
      expect(calls("git_add").map((args) => args?.filePath)).toEqual([
        "src/app.ts",
        "README.md",
        "old/gone.ts",
        "notes/todo.txt",
      ]);

      await click(view().getByRole("button", { name: "Unstage all" }));
      expect(calls("git_reset").map((args) => args?.filePath)).toEqual(["src/app.ts"]);

      await click(view().getByRole("button", { name: "Discard all" }));
      expect(mocks.confirm).toHaveBeenLastCalledWith(
        "Discard changes in 3 files? This can't be undone.",
        expect.anything(),
      );
      expect(calls("git_discard_file_changes").map((args) => args?.filePath)).toEqual([
        "src/app.ts",
        "README.md",
        "old/gone.ts",
      ]);

      await click(view().getByRole("button", { name: "Stash all" }));
      expect(calls("git_create_stash")).toEqual([
        { repoPath: "/repo", message: "WIP from sidebar", includeUntracked: true, files: null },
      ]);

      await click(view().getByRole("button", { name: "Review staged" }));
      expect(mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0])).toContain(
        "diff://working-tree/staged",
      );
    });

    it("filters changed files by path", async () => {
      await render();

      await typeInto(view().getByPlaceholderText("Filter changes"), "readme");

      expect(view().queryAllByTitle("src/app.ts")).toHaveLength(0);
      expect(row("README.md")).toBeTruthy();
    });

    it("collapses a section and remembers it", async () => {
      await render();

      await click(sectionHeader("Staged"));

      expect(view().queryByTitle("src/app.ts")?.textContent).not.toContain("app.ts ");
      expect(view().getAllByTitle("src/app.ts")).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem("athas:git-stream-sections")!)).toMatchObject({
        staged: false,
      });
    });

    it("shows a clean working tree", async () => {
      statusFiles = [];
      await render();

      expect(view().getByText("Working tree clean")).toBeTruthy();
    });

    it("drives the row context menu", async () => {
      await render();

      await openContextMenu(row("README.md"));
      await click(menuItem("Stage"));
      expect(calls("git_add")).toEqual([{ repoPath: "/repo", filePath: "README.md" }]);

      await openContextMenu(row("README.md"));
      await click(menuItem("Copy Path"));
      expect(mocks.clipboard).toEqual(["README.md"]);

      await openContextMenu(row("README.md"));
      await click(menuItem("Stash File"));
      expect(calls("git_create_stash")).toEqual([
        {
          repoPath: "/repo",
          message: "Stash README.md",
          includeUntracked: true,
          files: ["README.md"],
        },
      ]);

      await openContextMenu(row("README.md"));
      await click(menuItem("Discard Changes"));
      expect(calls("git_discard_file_changes")).toEqual([
        { repoPath: "/repo", filePath: "README.md" },
      ]);

      await openContextMenu(row("README.md"));
      await click(menuItem("Open File"));
      expect(onFileSelect).toHaveBeenCalledWith("/repo/README.md", false);

      await openContextMenu(row("src/app.ts", 0));
      expect(() => menuItem("Discard Changes")).toThrow();
      await click(menuItem("Unstage"));
      expect(calls("git_reset")).toEqual([{ repoPath: "/repo", filePath: "src/app.ts" }]);

      await openContextMenu(row("src/app.ts", 0));
      await click(menuItem("Open Diff"));
      await vi.waitFor(() =>
        expect(calls("git_diff_file")).toContainEqual({
          repoPath: "/repo",
          filePath: "src/app.ts",
          staged: true,
        }),
      );
    });

    it("compares changes from the compare menu", async () => {
      await render();

      await click(view().getByRole("button", { name: "Compare" }));
      await click(menuItem("Unstaged changes"));
      expect(mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0])).toContain(
        "diff://working-tree/unstaged",
      );

      await click(view().getByRole("button", { name: "Compare" }));
      await click(menuItem("Against a commit…"));
      expect(body().getByPlaceholderText("Compare working tree with commit...")).toBeTruthy();
      expect(body().getByText("6 commits")).toBeTruthy();
      await typeInto(body().getByPlaceholderText("Compare working tree with commit..."), "zzz");
      expect(body().getByText("No matching commits")).toBeTruthy();
      await typeInto(
        body().getByPlaceholderText("Compare working tree with commit..."),
        "number 3",
      );
      await click(within(body().getByRole("dialog")).getByText("Commit number 3"));
      expect(body().queryByPlaceholderText("Compare working tree with commit...")).toBeNull();
      await settle();
      expect(mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0])).toContain(
        `diff://commit/${commit(3).hash}/all-files`,
      );

      await click(view().getByRole("button", { name: "Compare" }));
      await click(menuItem("Against a branch…"));
      expect(body().getByText("2 branches")).toBeTruthy();
      expect(body().getByText("feature/login")).toBeTruthy();
      await typeInto(body().getByPlaceholderText("Compare current branch with..."), "nothing");
      expect(body().getByText("No other branches")).toBeTruthy();
      await typeInto(body().getByPlaceholderText("Compare current branch with..."), "dev");
      await click(within(body().getByRole("dialog")).getByText("dev"));
      await settle();
      expect(mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0])).toContain(
        `diff://branch/${encodeURIComponent("dev..main")}/all-files`,
      );
    });
  });

  describe("stashes and history", () => {
    it("reveals stashes from the palette and applies, pops and drops them", async () => {
      await render();
      expect(view().queryByText("WIP parser")).toBeNull();

      await act(async () => runPaneCommand("view:git", "action", { type: "view-stashes" }));
      await settle();
      const stash = titled("On main: WIP parser");

      await click(within(stash).getByRole("button", { name: "Apply" }));
      await click(within(stash).getByRole("button", { name: "Pop" }));
      await click(within(stash).getByRole("button", { name: "Drop" }));
      expect(calls("git_apply_stash")).toEqual([{ repoPath: "/repo", stashIndex: 0 }]);
      expect(calls("git_pop_stash")).toEqual([{ repoPath: "/repo", stashIndex: 0 }]);
      expect(calls("git_drop_stash")).toEqual([{ repoPath: "/repo", stashIndex: 0 }]);

      await click(stash);
      await settle();
      expect(mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0])).toContain(
        "diff://stash/0/all-files",
      );
    });

    it("marks unpushed commits, searches history and opens a commit", async () => {
      await render();
      const history = view().getByText("Commit number 1").closest("ol")!;

      expect(within(history).getAllByText("unpushed")).toHaveLength(1);
      expect(within(history).getAllByRole("listitem")).toHaveLength(6);

      await typeInto(view().getByPlaceholderText("Search message, author, hash"), "linus");
      expect(within(history).getAllByRole("listitem")).toHaveLength(3);
      expect(within(history).queryByText("unpushed")).toBeNull();

      await typeInto(view().getByPlaceholderText("Search message, author, hash"), "nobody");
      expect(view().getByText("No matching commits")).toBeTruthy();

      await typeInto(view().getByPlaceholderText("Search message, author, hash"), "");
      await click(view().getByText("Commit number 2"));
      await settle();
      expect(mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0])).toContain(
        `diff://commit/${commit(2).hash}/all-files`,
      );
    });

    it("expands the selected commit with its stats and actions", async () => {
      handlers.git_log = () => [commit(1, { description: "  Longer body text  " }), commit(2)];
      useBufferStore.setState({
        buffers: [
          {
            id: "diff-1",
            type: "diff",
            path: "diff://commit",
            diffData: {
              commitHash: commit(1).hash,
              files: [],
              totalFiles: 1,
              totalAdditions: 4,
              totalDeletions: 2,
            },
          },
        ] as never,
      });
      mocks.activeBufferId = "diff-1";
      mocks.prompts = ["from-commit"];
      await render();

      expect(view().getByText("Longer body text")).toBeTruthy();
      expect(view().getByText("1 file")).toBeTruthy();
      await click(view().getByRole("button", { name: "Copy commit hash" }));
      expect(mocks.clipboard).toEqual([commit(1).hash]);

      await click(view().getByRole("button", { name: "New branch from this commit" }));
      expect(calls("git_create_branch")).toEqual([
        { repoPath: "/repo", branchName: "from-commit", fromBranch: commit(1).hash },
      ]);
    });

    it("loads older commits when a full page came back", async () => {
      handlers.git_log = ({ skip }) =>
        skip ? [commit(9)] : Array.from({ length: 50 }, (_, index) => commit(index + 10));
      await render();

      await click(view().getByRole("button", { name: "Load older commits" }));

      expect(calls("git_log").slice(-1)[0]).toMatchObject({ skip: 50 });
      expect(useGitStore.getState().commits).toHaveLength(51);
    });

    it("shows an empty history and hides sections turned off in settings", async () => {
      handlers.git_log = () => [];
      await render();
      expect(view().getByText("No commits yet")).toBeTruthy();

      await act(async () => {
        useSettingsStore.setState({
          settings: {
            ...useSettingsStore.getState().settings,
            hiddenGitSidebarItems: ["changes", "history", "remotes", "tags"],
          },
        } as never);
      });
      await settle();
      expect(view().queryByText("No commits yet")).toBeNull();
      expect(view().queryAllByTitle("README.md")).toHaveLength(0);
      expect(
        within(view().getByRole("navigation")).queryByRole("button", { name: "Remotes" }),
      ).toBeNull();
    });
  });

  describe("panels", () => {
    it("switches, creates and deletes branches from the branches panel", async () => {
      mocks.prompts = ["topic", "from-dev"];
      await render();

      await click(tab("Branches"));
      expect(view().getByText("↑1 ↓0")).toBeTruthy();
      const local = titled("dev\nClick to switch");

      await click(local);
      expect(calls("git_checkout")).toEqual([{ repoPath: "/repo", branchName: "dev" }]);

      await click(view().getByRole("button", { name: "New branch" }));
      expect(calls("git_create_branch")).toContainEqual({
        repoPath: "/repo",
        branchName: "topic",
        fromBranch: "main",
      });

      await click(
        within(titled("dev\nClick to switch")).getByRole("button", {
          name: "New branch from this",
        }),
      );
      expect(calls("git_create_branch")).toContainEqual({
        repoPath: "/repo",
        branchName: "from-dev",
        fromBranch: "dev",
      });

      await click(within(titled("dev\nClick to switch")).getByRole("button", { name: "Delete" }));
      expect(calls("git_delete_branch")).toEqual([{ repoPath: "/repo", branchName: "dev" }]);

      await click(
        within(titled("feature/login\nClick to switch")).getByRole("button", {
          name: "Compare with main",
        }),
      );
      await settle();
      expect(mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0])).toContain(
        `diff://branch/${encodeURIComponent("feature/login..main")}/all-files`,
      );

      await click(view().getByRole("button", { name: "Copy name" }));
      expect(mocks.clipboard).toEqual(["main"]);
    });

    it("filters branches and collapses branch sections", async () => {
      await render();
      await click(view().getByTitle(/^\/repo\smain — switch branch$/));

      await typeInto(view().getByPlaceholderText("Filter branches"), "login");
      expect(view().queryByText("Current")).toBeNull();
      expect(view().getByText("feature/login")).toBeTruthy();

      await typeInto(view().getByPlaceholderText("Filter branches"), "zzz");
      expect(view().getByText("No matching branches")).toBeTruthy();

      await typeInto(view().getByPlaceholderText("Filter branches"), "");
      await click(sectionHeader("Local"));
      expect(view().queryByText("feature/login")).toBeNull();
      await click(sectionHeader("Local"));
      expect(view().getByText("feature/login")).toBeTruthy();

      await click(tab("Changes"));
      expect(view().getByPlaceholderText("Filter changes")).toBeTruthy();
    });

    it("lists worktrees and opens, adds and removes them", async () => {
      handlers.git_discover_repo = ({ path }) =>
        path.startsWith("/work/login") ? "/work/login" : path.startsWith("/repo") ? "/repo" : null;
      mocks.prompts = ["/work/repo-new", "repo-new"];
      await render();

      await click(tab("Worktrees"));
      const rows = view().getAllByTitle(/^\/work|^\/repo/);
      expect(rows.map((element) => element.title.split("\n")[0])).toEqual([
        "/repo",
        "/work/login",
        "/work/stale",
        "/work/detached",
      ]);
      expect(within(titled("/work/login\nClick to open")).getByText("locked")).toBeTruthy();
      expect(within(titled("/repo")).getAllByText("main")).toHaveLength(2);
      expect(within(titled("/work/detached\nClick to open")).getAllByText("detached")).toHaveLength(
        2,
      );
      expect(
        within(titled("/work/stale")).queryByRole("button", { name: "Open in new window" }),
      ).toBeNull();

      await click(titled("/work/login\nClick to open"));
      expect(mocks.openWorktree).toHaveBeenCalledWith("/work/login");
      expect(view().getByPlaceholderText("Filter changes")).toBeTruthy();

      await click(tab("Worktrees"));
      await click(
        within(titled("/work/detached\nClick to open")).getByRole("button", {
          name: "Open in new window",
        }),
      );
      expect(mocks.openWorktree).toHaveBeenLastCalledWith("/work/detached", {
        target: "new-window",
      });

      await click(
        within(titled("/work/detached\nClick to open")).getByRole("button", {
          name: "Copy path",
        }),
      );
      expect(mocks.clipboard).toEqual(["/work/detached"]);

      await click(view().getByRole("button", { name: "New worktree" }));
      expect(calls("git_add_worktree")).toEqual([
        { repoPath: "/repo", path: "/work/repo-new", branch: "repo-new", createBranch: true },
      ]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Worktree created");

      await click(
        within(titled("/work/detached\nClick to open")).getByRole("button", {
          name: "Remove",
        }),
      );
      expect(mocks.confirm).toHaveBeenLastCalledWith(
        "Remove the worktree at /work/detached? Its folder is deleted.",
        expect.anything(),
      );
      expect(calls("git_remove_worktree")).toEqual([
        { repoPath: "/repo", path: "/work/detached", force: false },
      ]);
    });

    it("reports worktree failures and filters worktrees", async () => {
      handlers.git_add_worktree = () => {
        throw new Error("exists");
      };
      handlers.git_remove_worktree = () => {
        throw new Error("dirty");
      };
      mocks.prompts = ["/work/x", ""];
      await render();
      await act(async () =>
        runPaneCommand("view:git", "action", { type: "manage-branches", tab: "worktrees" }),
      );
      await settle();

      await click(view().getByRole("button", { name: "New worktree" }));
      expect(calls("git_add_worktree")).toEqual([
        { repoPath: "/repo", path: "/work/x", branch: null, createBranch: false },
      ]);
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to create worktree");

      await click(
        within(titled("/work/detached\nClick to open")).getByRole("button", {
          name: "Remove",
        }),
      );
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Failed to remove worktree. It may have uncommitted changes.",
      );

      mocks.confirm.mockResolvedValueOnce(false);
      await click(
        within(titled("/work/detached\nClick to open")).getByRole("button", {
          name: "Remove",
        }),
      );
      expect(calls("git_remove_worktree")).toHaveLength(1);

      await click(view().getByRole("button", { name: "New worktree" }));
      expect(calls("git_add_worktree")).toHaveLength(1);

      const reads = calls("git_get_worktrees").length;
      await click(view().getByRole("button", { name: "Reload" }));
      expect(calls("git_get_worktrees").length).toBeGreaterThan(reads);

      await typeInto(view().getByPlaceholderText("Filter worktrees"), "nowhere");
      expect(view().getByText("No matching worktrees")).toBeTruthy();
    });

    it("manages remotes", async () => {
      mocks.prompts = ["upstream", "git@github.com:up/athas.git"];
      await render();

      expect(tab("Remotes").title).toBe("Remotes (2)");
      await act(async () => runPaneCommand("view:git", "action", { type: "manage-remotes" }));
      await settle();
      expect(view().getByText("git@github.com:me/athas.git")).toBeTruthy();

      await click(view().getByRole("button", { name: "Fetch all" }));
      expect(calls("git_fetch")).toEqual([{ repoPath: "/repo", remote: null }]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Fetched");

      await click(view().getByRole("button", { name: "Fetch fork" }));
      expect(calls("git_fetch").slice(-1)[0]).toEqual({ repoPath: "/repo", remote: "fork" });
      expect(mocks.toast.success).toHaveBeenCalledWith("Fetched fork");

      handlers.git_fetch = () => {
        throw new Error("offline");
      };
      await click(view().getByRole("button", { name: "Fetch origin" }));
      expect(mocks.toast.error).toHaveBeenCalled();

      await click(view().getByRole("button", { name: "Add remote" }));
      expect(calls("git_add_remote")).toEqual([
        { repoPath: "/repo", name: "upstream", url: "git@github.com:up/athas.git" },
      ]);

      await click(
        within(titled("git@github.com:me/athas.git")).getByRole("button", {
          name: "Copy URL",
        }),
      );
      expect(mocks.clipboard).toEqual(["git@github.com:me/athas.git"]);

      await click(
        within(titled("git@github.com:me/athas.git")).getByRole("button", {
          name: "Remove",
        }),
      );
      expect(mocks.confirm).toHaveBeenLastCalledWith('Remove remote "fork"?', expect.anything());
      expect(calls("git_remove_remote")).toEqual([{ repoPath: "/repo", name: "fork" }]);

      await typeInto(view().getByPlaceholderText("Filter remotes"), "zzz");
      expect(view().getByText("No matching remotes")).toBeTruthy();
    });

    it("reports remote failures and shows an empty remote list", async () => {
      handlers.git_get_remotes = () => [];
      handlers.git_add_remote = () => {
        throw new Error("bad url");
      };
      mocks.prompts = ["origin", "nope"];
      await render();
      await click(tab("Remotes"));

      expect(view().getByText("No remotes")).toBeTruthy();
      expect(view().getByText("Add one to push and pull.")).toBeTruthy();
      expect(
        (view().getByRole("button", { name: "Fetch all" }) as HTMLButtonElement).disabled,
      ).toBe(true);

      await click(view().getByRole("button", { name: "Add remote" }));
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to add remote");

      mocks.prompts = ["origin", " "];
      await click(view().getByRole("button", { name: "Add remote" }));
      expect(calls("git_add_remote")).toHaveLength(1);
    });

    it("manages tags", async () => {
      mocks.prompts = ["v3.0.0", "Third"];
      await render();

      await act(async () => runPaneCommand("view:git", "action", { type: "manage-tags" }));
      await settle();
      expect(view().getByText("Second")).toBeTruthy();
      expect(view().getByText("1111111")).toBeTruthy();

      await click(view().getByText("v2.0.0"));
      await click(
        within(view().getByText("v1.0.0").closest("[title]")!).getByRole("button", {
          name: "Compare with HEAD",
        }),
      );
      await settle();
      const opened = mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0]);
      expect(calls("git_ref_diff")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ baseRef: "v1.0.0", targetRef: "v2.0.0" }),
          expect.objectContaining({ baseRef: "HEAD", targetRef: "v1.0.0" }),
        ]),
      );
      expect(opened.length).toBeGreaterThanOrEqual(2);

      await click(view().getByRole("button", { name: "New tag" }));
      expect(calls("git_create_tag")).toEqual([
        {
          repoPath: "/repo",
          name: "v3.0.0",
          message: "Third",
          commit: null,
          signed: false,
        },
      ]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Created v3.0.0");

      await typeInto(view().getByPlaceholderText("Filter tags"), "v9");
      expect(view().getByText("No matching tags")).toBeTruthy();
    });

    it("runs tag menu actions", async () => {
      await render();
      await click(tab("Tags"));
      const tagRow = () => view().getByText("v2.0.0").closest("[title]") as HTMLElement;
      const choose = async (label: string) => {
        await click(within(tagRow()).getByRole("button", { name: "Tag actions" }));
        await click(menuItem(label));
      };

      await choose("Push to origin");
      expect(calls("git_push_tag")).toEqual([
        { repoPath: "/repo", name: "v2.0.0", remote: "origin" },
      ]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Pushed v2.0.0");

      await choose("Delete from origin");
      expect(calls("git_delete_remote_tag")).toEqual([
        { repoPath: "/repo", name: "v2.0.0", remote: "origin" },
      ]);

      await choose("Checkout tag");
      expect(calls("git_checkout_tag")).toEqual([{ repoPath: "/repo", name: "v2.0.0" }]);

      await choose("Copy name");
      await choose("Copy commit SHA");
      expect(mocks.clipboard).toEqual(["v2.0.0", "2222222abc"]);

      await choose("Compare with v1.0.0");
      await choose("Compare with HEAD");
      expect(calls("git_ref_diff").length).toBeGreaterThanOrEqual(2);

      await choose("Delete local tag");
      expect(mocks.confirm).toHaveBeenLastCalledWith('Delete tag "v2.0.0"?', expect.anything());
      expect(calls("git_delete_tag")).toEqual([{ repoPath: "/repo", name: "v2.0.0" }]);
    });

    it("reports failing tag actions", async () => {
      handlers.git_push_tag = () => {
        throw new Error("denied");
      };
      handlers.git_checkout_tag = () => ({ success: false, hasChanges: false, message: "dirty" });
      handlers.git_delete_tag = () => {
        throw new Error("missing");
      };
      handlers.git_create_tag = () => {
        throw new Error("exists");
      };
      mocks.prompts = ["v1.0.0", ""];
      await render();
      await click(tab("Tags"));
      const choose = async (label: string) => {
        await click(
          within(view().getByText("v2.0.0").closest("[title]") as HTMLElement).getByRole("button", {
            name: "Tag actions",
          }),
        );
        await click(menuItem(label));
      };

      await choose("Push to origin");
      expect(mocks.toast.error).toHaveBeenCalled();
      await choose("Checkout tag");
      expect(mocks.toast.error).toHaveBeenCalledWith("dirty");
      await choose("Delete local tag");
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to delete tag");

      await click(view().getByRole("button", { name: "New tag" }));
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to create tag");
    });

    it("shows no tags", async () => {
      handlers.git_get_tags = () => [];
      await render();
      await click(tab("Tags"));

      expect(view().getByText("No tags")).toBeTruthy();
    });

    it("switches between repositories", async () => {
      mocks.discoverRepos.mockResolvedValue(["/repo", "/repo/packages/lib"]);
      handlers.git_discover_repo = ({ path }) =>
        path.startsWith("/repo/packages/lib")
          ? "/repo/packages/lib"
          : path.startsWith("/repo")
            ? "/repo"
            : null;
      await act(async () => {
        const { useProjectStore } = await import("@/features/workspace/stores/project.store");
        useProjectStore.setState({ rootFolderPath: "/repo" });
      });
      await render();

      await click(tab("Repos"));
      expect(titled("/repo/packages/lib")).toBeTruthy();

      await typeInto(view().getByPlaceholderText("Filter repositories"), "zzz");
      expect(view().getByText("No matching repositories")).toBeTruthy();
      await typeInto(view().getByPlaceholderText("Filter repositories"), "");

      await click(within(titled("/repo/packages/lib")).getByRole("button", { name: "Copy path" }));
      expect(mocks.clipboard).toEqual(["/repo/packages/lib"]);

      await click(titled("/repo/packages/lib"));
      expect(useRepositoryStore.getState().activeRepoPath).toBe("/repo/packages/lib");
    });
  });

  it("responds to palette actions", async () => {
    await render();
    const statusReads = calls("git_status").length;

    await act(async () => runPaneCommand("view:git", "action", { type: "refresh" }));
    await settle();
    expect(calls("git_status").length).toBeGreaterThan(statusReads);

    await act(async () => runPaneCommand("view:git", "action", { type: "show-branch-diff" }));
    await settle();
    expect(body().getByPlaceholderText("Compare current branch with...")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(body().getByPlaceholderText("Compare current branch with..."), {
        key: "Escape",
      });
    });
    await settle();

    await act(async () =>
      runPaneCommand("view:git", "action", { type: "manage-branches", tab: "branches" }),
    );
    await settle();
    expect(view().getByPlaceholderText("Filter branches")).toBeTruthy();

    await act(async () =>
      runPaneCommand("view:git", "action", { type: "show-tab", tab: "history" }),
    );
    await settle();
    expect(view().getByPlaceholderText("Filter changes")).toBeTruthy();

    mocks.pickDirectory.mockResolvedValue(null);
    await act(async () => runPaneCommand("view:git", "action", { type: "select-repository" }));
    await settle();
    expect(mocks.pickDirectory).toHaveBeenCalled();
  });
});

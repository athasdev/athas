// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";
import { emitGitChanged } from "../events/git-events";
import { useGitDataController } from "../hooks/use-git-data-controller";
import { useRepositoryStore } from "../stores/git-repository.store";
import { useGitStore } from "../stores/git.store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create } = await import("zustand");
  return {
    useSettingsStore: create(() => ({ settings: { autoRefreshGitStatus: true } })),
  };
});

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;

function status(branch: string, files: unknown[] = []) {
  return { branch, ahead: 0, behind: 0, files };
}

function calls(command: string) {
  return mockInvoke.mock.calls.filter(([name]) => name === command).length;
}

let root: Root;

type ControllerProps = { workspacePath?: string | null; isActive?: boolean };

function renderController() {
  const result = { current: undefined as unknown as ReturnType<typeof useGitDataController> };
  function Harness(harnessProps: ControllerProps) {
    result.current = useGitDataController(harnessProps);
    return null;
  }
  const render = (next: ControllerProps) => act(async () => root.render(<Harness {...next} />));
  return { result, render };
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useGitDataController", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    workspaceRuntimeRegistry.resetForTests();
    clearRepositoryDiscoveryCache();
    useSettingsStore.setState({ settings: { autoRefreshGitStatus: true } } as never);
    handlers = {
      git_discover_repo: ({ path }) =>
        path.startsWith("/repo") ? "/repo" : path.startsWith("/other") ? "/other" : null,
      git_status: ({ repoPath }) => status(repoPath === "/repo" ? "main" : "other-main"),
      git_log: () => [{ hash: "c1", message: "first" }],
      git_branches: () => ["main", "dev"],
      git_get_stashes: () => [{ index: 0, message: "wip" }],
    };
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command, args) => {
      const handler = handlers[command];
      return handler ? handler((args ?? {}) as Record<string, any>) : null;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  it("discovers the workspace repository and loads its git data", async () => {
    const { result, render } = renderController();
    await render({ workspacePath: "/repo", isActive: true });
    await settle();

    expect(result.current.activeRepoPath).toBe("/repo");
    const state = useGitStore.getState();
    expect(state.gitStatus).toMatchObject({ branch: "main" });
    expect(state.commits).toEqual([{ hash: "c1", message: "first" }]);
    expect(state.branches).toEqual(["main", "dev"]);
    expect(state.stashes).toEqual([{ index: 0, message: "wip" }]);
    expect(state.hasMoreCommits).toBe(false);
    expect(state.isLoadingGitData).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("git_log", { repoPath: "/repo", limit: 50, skip: 0 });
  });

  it("does nothing without a repository", async () => {
    const { result, render } = renderController();
    await render({ workspacePath: "/none" });
    await settle();

    expect(result.current.activeRepoPath).toBeNull();
    expect(calls("git_status")).toBe(0);
    await act(() => result.current.refreshGitData());
    expect(calls("git_status")).toBe(0);
  });

  it("drops a load that finishes after the user switched repositories", async () => {
    let releaseRepo: () => void = () => {};
    handlers.git_status = ({ repoPath }) =>
      repoPath === "/repo"
        ? new Promise((resolve) => {
            releaseRepo = () => resolve(status("stale"));
          })
        : status("other-main");
    const { render } = renderController();
    await render({ workspacePath: "/repo" });
    await settle();

    await act(async () => useRepositoryStore.getState().actions.selectRepository("/other"));
    await settle();
    releaseRepo();
    await settle();

    expect(useRepositoryStore.getState().activeRepoPath).toBe("/other");
    expect(useGitStore.getState().gitStatus).toMatchObject({ branch: "other-main" });
  });

  it("logs a failed load and clears the loading flag", async () => {
    handlers.git_log = () => {
      throw new Error("corrupt");
    };
    const { render } = renderController();
    await render({ workspacePath: "/repo" });
    await settle();

    expect(useGitStore.getState().isLoadingGitData).toBe(false);
    expect(useGitStore.getState().commits).toEqual([]);
  });

  it("refreshes only the scopes a git change touched", async () => {
    const { render } = renderController();
    await render({ workspacePath: "/repo", isActive: true });
    await settle();
    mockInvoke.mockClear();
    handlers.git_get_stashes = () => [{ index: 0, message: "new" }];

    emitGitChanged({ repoPath: "/repo", scopes: ["stashes"], source: "create-stash" });
    await vi.waitFor(() => expect(calls("git_get_stashes")).toBe(1));
    await settle();

    expect(calls("git_status")).toBe(1);
    expect(calls("git_branches")).toBe(0);
    expect(calls("git_log")).toBe(0);
    expect(useGitStore.getState().stashes).toEqual([{ index: 0, message: "new" }]);
  });

  it("refreshes refs and history for repository-wide changes", async () => {
    const { render } = renderController();
    await render({ workspacePath: "/repo", isActive: true });
    await settle();
    mockInvoke.mockClear();
    handlers.git_branches = () => ["main", "dev", "new"];
    handlers.git_log = () => [{ hash: "c2" }, { hash: "c1" }];

    emitGitChanged({ repoPath: "/repo", scopes: ["history", "refs"] });
    await vi.waitFor(() => expect(useGitStore.getState().branches).toHaveLength(3));

    expect(useGitStore.getState().commits).toEqual([{ hash: "c2" }, { hash: "c1" }]);
    expect(calls("git_get_stashes")).toBe(0);
  });

  it("debounces bursts of changes into one refresh and ignores other repositories", async () => {
    const { render } = renderController();
    await render({ workspacePath: "/repo", isActive: true });
    await settle();
    mockInvoke.mockClear();

    emitGitChanged({ repoPath: "/elsewhere", scopes: ["working-tree"] });
    emitGitChanged({ repoPath: "/repo", scopes: ["working-tree"] });
    emitGitChanged({ repoPath: "/repo", scopes: ["working-tree"] });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await settle();

    expect(calls("git_status")).toBe(1);
  });

  it("ignores passive saves when automatic refresh is off", async () => {
    useSettingsStore.setState({ settings: { autoRefreshGitStatus: false } } as never);
    const { render } = renderController();
    await render({ workspacePath: "/repo", isActive: true });
    await settle();
    mockInvoke.mockClear();

    emitGitChanged({ repoPath: "/repo", scopes: ["working-tree"], source: "save" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls("git_status")).toBe(0);

    emitGitChanged({ repoPath: "/repo", scopes: ["working-tree"], source: "commit" });
    await vi.waitFor(() => expect(calls("git_status")).toBe(1));
  });

  it("refreshes when the panel becomes active again", async () => {
    const { render } = renderController();
    await render({ workspacePath: "/repo", isActive: false });
    await settle();
    mockInvoke.mockClear();

    await render({ workspacePath: "/repo", isActive: true });
    await settle();
    expect(calls("git_status")).toBe(1);

    await render({ workspacePath: "/repo", isActive: true });
    await settle();
    expect(calls("git_status")).toBe(1);
  });

  it("shares one request between concurrent refreshes and toggles the refreshing flag", async () => {
    const { result, render } = renderController();
    await render({ workspacePath: "/repo" });
    await settle();
    mockInvoke.mockClear();
    let release: () => void = () => {};
    handlers.git_status = () =>
      new Promise((resolve) => {
        release = () => resolve(status("main"));
      });

    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.refresh();
      void result.current.refreshGitData();
    });
    expect(useGitStore.getState().isRefreshing).toBe(true);
    await vi.waitFor(() => expect(calls("git_status")).toBe(1));
    release();
    await act(() => refreshing);

    expect(calls("git_status")).toBe(1);
    expect(useGitStore.getState().isRefreshing).toBe(false);
  });
});

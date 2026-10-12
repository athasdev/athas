// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { create } from "zustand";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const harness = vi.hoisted(() => ({
  settings: {
    hiddenSidebarActivityItems: [] as string[],
    pinnedSidebarExtensionItems: [] as string[],
  },
}));

vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create: createStore } = await import("zustand");
  const store = createStore<{
    settings: typeof harness.settings;
    actions: { updateSetting: (key: string, value: unknown) => Promise<void> };
  }>()((set) => ({
    settings: harness.settings,
    actions: {
      updateSetting: async (key, value) =>
        set((state) => ({ settings: { ...state.settings, [key]: value } })),
    },
  }));
  return { useSettingsStore: store };
});

vi.mock("@/features/layout/stores/ui-state.store", async () => {
  const { create: createStore } = await import("zustand");
  const store = createStore<Record<string, unknown>>()((set) => ({
    isSidebarVisible: true,
    isRightSidebarVisible: false,
    isGitViewActive: false,
    isGitHubPRsViewActive: false,
    activeSidebarView: "files",
    activeRightSidebarView: "agent",
    setActiveView: (view: string) =>
      set({
        activeSidebarView: view,
        isGitViewActive: view === "git",
        isGitHubPRsViewActive: view === "github-prs",
      }),
    setActiveRightSidebarView: (view: string) => set({ activeRightSidebarView: view }),
    setIsSidebarVisible: (visible: boolean) => set({ isSidebarVisible: visible }),
    setIsRightSidebarVisible: (visible: boolean) => set({ isRightSidebarVisible: visible }),
  }));
  return { useUIState: store };
});

import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/services/workspace-session-repository";
import { normalizeItemOrder, SIDEBAR_ACTIVITY_ITEM_IDS } from "../config/item-order";
import { useActivityBarVisibility } from "../hooks/use-activity-bar-visibility";
import { useResponsiveWorkbenchLayout } from "../hooks/use-responsive-workbench-layout";
import { useSidebarPaneController } from "../hooks/use-sidebar-pane-controller";
import { createTerminalSlice, type TerminalSlice } from "../stores/ui-state/terminal-slice";
import { createViewSlice, type ViewSlice } from "../stores/ui-state/view-slice";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function renderHook<T>(useHook: () => T) {
  const result = {} as { current: T };
  function Probe() {
    result.current = useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { result, unmount: () => act(() => root.unmount()) };
}

const uiStore = useUIState as unknown as {
  getState: () => Record<string, unknown>;
  setState: (state: Record<string, unknown>) => void;
};
const settingsStore = useSettingsStore as unknown as {
  getState: () => { settings: typeof harness.settings };
  setState: (state: object) => void;
};

beforeEach(() => {
  uiStore.setState({
    isSidebarVisible: true,
    isRightSidebarVisible: false,
    isGitViewActive: false,
    isGitHubPRsViewActive: false,
    activeSidebarView: "files",
    activeRightSidebarView: "agent",
  });
  settingsStore.setState({
    settings: { hiddenSidebarActivityItems: [], pinnedSidebarExtensionItems: [] },
  });
});

afterEach(() => {
  useProjectStore.setState({ rootFolderPath: undefined });
});

describe("useSidebarPaneController", () => {
  it("switches primary views and collapses the sidebar when the active view is clicked", () => {
    const { result, unmount } = renderHook(useSidebarPaneController);

    act(() => result.current.openSidebarView("git"));
    expect(uiStore.getState()).toMatchObject({ activeSidebarView: "git", isSidebarVisible: true });

    act(() => result.current.openSidebarView("git"));
    expect(uiStore.getState().isSidebarVisible).toBe(false);

    act(() => result.current.openSidebarView("files"));
    expect(uiStore.getState()).toMatchObject({
      activeSidebarView: "files",
      isSidebarVisible: true,
    });
    unmount();
  });

  it("toggles edge views in the right sidebar", () => {
    const { result, unmount } = renderHook(useSidebarPaneController);

    act(() => result.current.openSidebarView("agent"));
    expect(uiStore.getState()).toMatchObject({
      activeRightSidebarView: "agent",
      isRightSidebarVisible: true,
    });

    act(() => result.current.openSidebarView("agent"));
    expect(uiStore.getState().isRightSidebarVisible).toBe(false);

    act(() => result.current.openSidebarView("files", { paneLevel: "edge" }));
    expect(uiStore.getState()).toMatchObject({
      activeRightSidebarView: "files",
      isRightSidebarVisible: true,
    });
    unmount();
  });
});

describe("useActivityBarVisibility", () => {
  it("hides and shows core items and never hides search", () => {
    settingsStore.setState({
      settings: {
        hiddenSidebarActivityItems: ["search", "docker"],
        pinnedSidebarExtensionItems: [],
      },
    });
    const { result, unmount } = renderHook(useActivityBarVisibility);

    expect(result.current.isNavigationItemVisible("docker")).toBe(false);
    expect(result.current.isNavigationItemVisible("files")).toBe(true);

    act(() => result.current.setNavigationItemVisible("git", false));
    act(() => result.current.setNavigationItemVisible("git", false));
    act(() => result.current.setNavigationItemVisible("docker", true));

    expect(settingsStore.getState().settings.hiddenSidebarActivityItems).toEqual(["search", "git"]);
    expect(result.current.isNavigationItemVisible("git")).toBe(false);
    expect(result.current.isNavigationItemVisible("docker")).toBe(true);
    unmount();
  });

  it("pins extension items explicitly", () => {
    const { result, unmount } = renderHook(useActivityBarVisibility);

    expect(result.current.isNavigationItemVisible("ext.todo")).toBe(false);
    act(() => result.current.setNavigationItemVisible("ext.todo", true));
    act(() => result.current.setNavigationItemVisible("ext.todo", true));
    expect(settingsStore.getState().settings.pinnedSidebarExtensionItems).toEqual(["ext.todo"]);
    expect(result.current.isNavigationItemVisible("ext.todo")).toBe(true);

    act(() => result.current.setNavigationItemVisible("ext.todo", false));
    expect(result.current.isNavigationItemVisible("ext.todo")).toBe(false);
    unmount();
  });

  it("shows every item at once", () => {
    settingsStore.setState({
      settings: { hiddenSidebarActivityItems: ["git"], pinnedSidebarExtensionItems: [] },
    });
    const { result, unmount } = renderHook(useActivityBarVisibility);

    act(() => result.current.showAll(["files", "git", "ext.todo", "ext.db"]));

    expect(settingsStore.getState().settings).toEqual({
      hiddenSidebarActivityItems: [],
      pinnedSidebarExtensionItems: ["ext.todo", "ext.db"],
    });
    unmount();
  });
});

describe("useResponsiveWorkbenchLayout", () => {
  it("only changes when the narrow breakpoint is crossed", () => {
    Object.assign(window, { innerWidth: 1200 });
    const { result, unmount } = renderHook(useResponsiveWorkbenchLayout);
    const wide = result.current;
    expect(wide).toEqual({ narrow: false });

    act(() => {
      Object.assign(window, { innerWidth: 1000 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(wide);

    act(() => {
      Object.assign(window, { innerWidth: 600 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ narrow: true });
    unmount();
  });
});

describe("normalizeItemOrder", () => {
  it("keeps the saved order, drops unknown and duplicate ids and appends new ones", () => {
    expect(normalizeItemOrder(undefined, SIDEBAR_ACTIVITY_ITEM_IDS)).toEqual([
      ...SIDEBAR_ACTIVITY_ITEM_IDS,
    ]);
    expect(
      normalizeItemOrder<string>(["git", "removed", "git", "files"], ["files", "git", "docker"]),
    ).toEqual(["git", "files", "docker"]);
  });
});

describe("view and terminal slices", () => {
  it("tracks the active view and saves it with the project UI state", () => {
    const store = create<ViewSlice>()(createViewSlice);
    useProjectStore.setState({ rootFolderPath: "/projects/view-slice" });

    store.getState().setActiveView("github-prs");
    store.getState().setActiveRightSidebarView("collaboration");

    expect(store.getState()).toMatchObject({
      isGitViewActive: false,
      isGitHubPRsViewActive: true,
      activeSidebarView: "github-prs",
      activeRightSidebarView: "collaboration",
    });
    expect(workspaceSessionRepository.loadUi("/projects/view-slice")).toMatchObject({
      activeSidebarView: "github-prs",
    });
  });

  it("does not save the view without an open project", () => {
    const save = vi.spyOn(workspaceSessionRepository, "saveUi");
    const store = create<ViewSlice>()(createViewSlice);

    store.getState().setActiveView("git");

    expect(store.getState().isGitViewActive).toBe(true);
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  it("focuses the registered terminal on request", () => {
    const store = create<TerminalSlice>()(createTerminalSlice);
    const focus = vi.fn();

    store.getState().requestTerminalFocus();
    store.getState().registerTerminalFocus(focus);
    store.getState().requestTerminalFocus();
    store.getState().clearTerminalFocus();
    store.getState().requestTerminalFocus();

    expect(focus).toHaveBeenCalledOnce();
  });
});

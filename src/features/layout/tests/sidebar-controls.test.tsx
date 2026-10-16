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
    isGitViewActive: false,
    isGitHubPRsViewActive: false,
    activeSidebarView: "files",
    setActiveView: (view: string) =>
      set({
        activeSidebarView: view,
        isGitViewActive: view === "git",
        isGitHubPRsViewActive: view === "github-prs",
      }),
    setIsSidebarVisible: (visible: boolean) => set({ isSidebarVisible: visible }),
  }));
  return { useUIState: store };
});

import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/services/workspace-session-repository";
import { GIT_SIDEBAR_ITEM_IDS, normalizeItemOrder } from "../config/item-order";
import { useResponsiveWorkbenchLayout } from "../hooks/use-responsive-workbench-layout";
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
    isGitViewActive: false,
    isGitHubPRsViewActive: false,
    activeSidebarView: "files",
  });
  settingsStore.setState({
    settings: { hiddenSidebarActivityItems: [], pinnedSidebarExtensionItems: [] },
  });
});

afterEach(() => {
  useProjectStore.setState({ rootFolderPath: undefined });
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
    expect(normalizeItemOrder(undefined, GIT_SIDEBAR_ITEM_IDS)).toEqual([...GIT_SIDEBAR_ITEM_IDS]);
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

    expect(store.getState()).toMatchObject({
      isGitViewActive: false,
      isGitHubPRsViewActive: true,
      activeSidebarView: "github-prs",
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

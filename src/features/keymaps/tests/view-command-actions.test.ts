// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { editorAPI } from "@/features/editor/services/editor-api";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorSettingOverridesStore } from "@/features/editor/stores/editor-setting-overrides.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useZoomStore } from "@/features/layout/stores/zoom.store";
import { selectDockLayout, useDockLayoutStore } from "@/features/layout/stores/dock-layout.store";
import type { DockOwner } from "@/features/layout/types/dock.types";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { onAppEvent } from "@/utils/app-events";
import { useKeymapStore } from "../stores/keymaps.store";
import {
  openCommandPalette,
  openDiagnosticsBuffer,
  openGlobalSearchBuffer,
  openKeyboardShortcuts,
  resetZoom,
  showFind,
  showFindReplace,
  showNotifications,
  showThemeSelector,
  toggleDockerSidebar,
  toggleFilesSidebar,
  toggleGitHubSidebar,
  toggleLineNumbers,
  toggleMinimap,
  toggleRenderWhitespace,
  toggleSidebar,
  toggleSourceControlSidebar,
  toggleTerminalPane,
  toggleViewsSidebar,
  toggleWordWrap,
  zoomIn,
  zoomOut,
} from "../commands/view-command-actions";

const browserManager = vi.hoisted(() => ({
  zoom: vi.fn(),
}));

vi.mock("@/features/browser/services/browser-tab-manager", () => ({
  browserTabManager: browserManager,
}));

const ui = () => useUIState.getState();
const settings = () => useSettingsStore.getState().settings;

function listen(name: Parameters<typeof onAppEvent>[0]) {
  const handler = vi.fn();
  cleanups.push(onAppEvent(name, handler as never));
  return handler;
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  useEditorSettingOverridesStore.getState().actions.clearOverrides();
  useZoomStore.setState({ editorZoomLevel: 1, terminalZoomLevel: 1 });
  useKeymapStore.setState((state) => ({
    contexts: { ...state.contexts, terminalFocus: false },
  }));
  editorAPI.setActiveFindAdapter(null);
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = "";
  useBufferStore.setState({ buffers: [] });
  seedActiveBuffer(null);
  vi.useRealTimers();
  vi.clearAllMocks();
});

const dockPanes = (owner: DockOwner) =>
  selectDockLayout(useDockLayoutStore.getState(), owner).panes;

describe("sidebar toggles", () => {
  it("flips the sidebar visibility", () => {
    ui().setIsSidebarVisible(true);
    toggleSidebar();
    expect(ui().isSidebarVisible).toBe(false);
    toggleSidebar();
    expect(ui().isSidebarVisible).toBe(true);
  });

  it.each([
    ["files", toggleFilesSidebar],
    ["git", toggleSourceControlSidebar],
    ["github-prs", toggleGitHubSidebar],
    ["views", toggleViewsSidebar],
    ["docker", toggleDockerSidebar],
  ] as const)("opens %s in the project's dock, then closes it there", (view, toggle) => {
    useProjectStore.setState({ rootFolderPath: "/work/site" });
    useDockLayoutStore.setState({ layouts: {}, hidden: false, currentOwner: null });
    const owner = { kind: "project", id: "/work/site" } as const;
    const pane = `view:${view}`;
    if (view === "files") useDockLayoutStore.getState().actions.close(owner, pane);

    toggle();
    expect(dockPanes(owner)).toContain(pane);
    expect(ui().isSidebarVisible).toBe(true);

    toggle();
    expect(dockPanes(owner)).not.toContain(pane);
  });

  it("opens a tool in the dock of the session it shows", () => {
    const session = { kind: "session", id: "chat-1" } as const;
    useDockLayoutStore.setState({ layouts: {}, hidden: false, currentOwner: session });
    toggleSourceControlSidebar();
    expect(dockPanes(session)).toEqual(["view:git"]);
    useDockLayoutStore.setState({ currentOwner: null });
  });
});

describe("terminal pane toggle", () => {
  it("opens the terminal tab, asks for a session, then focuses the terminal", () => {
    vi.useFakeTimers();
    const ensureSession = listen("terminal:ensure-session");
    const focus = vi.fn();
    ui().registerTerminalFocus(focus);
    ui().setIsBottomPaneVisible(false);

    toggleTerminalPane();

    expect(ui().isBottomPaneVisible).toBe(true);
    expect(ui().bottomPaneActiveTab).toBe("terminal");
    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("switches from another bottom tab to the terminal rather than hiding the pane", () => {
    ui().setBottomPaneActiveTab("diagnostics");
    ui().setIsBottomPaneVisible(true);

    toggleTerminalPane();

    expect(ui().isBottomPaneVisible).toBe(true);
    expect(ui().bottomPaneActiveTab).toBe("terminal");
  });

  it("hides the bottom pane when the terminal is showing", () => {
    ui().setBottomPaneActiveTab("terminal");
    ui().setIsBottomPaneVisible(true);
    const ensureSession = listen("terminal:ensure-session");

    toggleTerminalPane();

    expect(ui().isBottomPaneVisible).toBe(false);
    expect(ensureSession).not.toHaveBeenCalled();
  });
});

describe("find", () => {
  it("opens the file tree search when focus is inside the file tree", () => {
    const tree = document.createElement("div");
    tree.className = "file-tree-container";
    const input = document.createElement("input");
    tree.appendChild(input);
    document.body.appendChild(tree);
    input.focus();
    const treeSearch = listen("file-tree:open-search");
    const terminalSearch = listen("terminal:open-search");

    showFind();

    expect(treeSearch).toHaveBeenCalledTimes(1);
    expect(terminalSearch).not.toHaveBeenCalled();
  });

  it("opens terminal search while the terminal has focus", () => {
    useKeymapStore.setState((state) => ({ contexts: { ...state.contexts, terminalFocus: true } }));
    const terminalSearch = listen("terminal:open-search");
    const openFind = vi.fn();
    editorAPI.setActiveFindAdapter({ ownerId: "test", openFind });

    showFind();

    expect(terminalSearch).toHaveBeenCalledTimes(1);
    expect(openFind).not.toHaveBeenCalled();
  });

  it("hands find to the active editor and hides the fallback find bar", () => {
    const openFind = vi.fn();
    editorAPI.setActiveFindAdapter({ ownerId: "test", openFind });
    ui().setIsFindVisible(true);

    showFind();
    expect(openFind).toHaveBeenLastCalledWith(false);
    expect(ui().isFindVisible).toBe(false);

    showFindReplace();
    expect(openFind).toHaveBeenLastCalledWith(true);
    expect(ui().isFindVisible).toBe(false);
  });

  it("toggles the fallback find bar when no editor can search", () => {
    ui().setIsFindVisible(false);
    showFind();
    expect(ui().isFindVisible).toBe(true);
    showFind();
    expect(ui().isFindVisible).toBe(false);

    showFindReplace();
    expect(ui().isFindVisible).toBe(true);
    showFindReplace();
    expect(ui().isFindVisible).toBe(true);
  });
});

describe("palettes and special buffers", () => {
  it("opens the command palette, theme view, and keyboard settings", () => {
    openCommandPalette();
    expect(ui().isCommandPaletteVisible).toBe(true);

    showThemeSelector();
    expect(ui().commandPaletteInitialView).toBe("color-theme");

    openKeyboardShortcuts();
    expect(ui().isSettingsVisible).toBe(true);
    expect(ui().settingsInitialTab).toBe("keyboard");
    expect(ui().isCommandPaletteVisible).toBe(false);
  });

  it("opens the diagnostics and global search buffers as active tabs", () => {
    openDiagnosticsBuffer();
    expect(useBufferStore.getState().actions.getActiveBuffer()?.type).toBe("diagnostics");

    openGlobalSearchBuffer();
    expect(useBufferStore.getState().actions.getActiveBuffer()?.type).toBe("globalSearch");
  });

  it("asks the notification center to show itself", () => {
    const notifications = listen("notifications:show");
    showNotifications();
    expect(notifications).toHaveBeenCalledTimes(1);
  });
});

describe("editor view settings", () => {
  it("toggles the minimap setting", () => {
    const initial = settings().showMinimap;
    toggleMinimap();
    expect(settings().showMinimap).toBe(!initial);
    toggleMinimap();
    expect(settings().showMinimap).toBe(initial);
  });

  it("flips line numbers from what an extension override shows, and drops the override", () => {
    void useSettingsStore.getState().actions.updateSetting("lineNumbers", true);
    useEditorSettingOverridesStore.getState().actions.setOverrides({ lineNumbers: false });

    toggleLineNumbers();

    expect(settings().lineNumbers).toBe(true);
    expect(useEditorSettingOverridesStore.getState().overrides.lineNumbers).toBeUndefined();

    toggleLineNumbers();
    expect(settings().lineNumbers).toBe(false);
  });

  it("cycles whitespace rendering between none and all", () => {
    void useSettingsStore.getState().actions.updateSetting("renderWhitespace", "boundary");
    toggleRenderWhitespace();
    expect(settings().renderWhitespace).toBe("none");
    toggleRenderWhitespace();
    expect(settings().renderWhitespace).toBe("all");
  });

  it("toggles word wrap", () => {
    void useSettingsStore.getState().actions.updateSetting("horizontalTabScroll", false);
    void useSettingsStore.getState().actions.updateSetting("wordWrap", false);
    toggleWordWrap();
    expect(settings().wordWrap).toBe(true);
    toggleWordWrap();
    expect(settings().wordWrap).toBe(false);
  });
});

describe("zoom", () => {
  it("zooms the editor by default", () => {
    zoomIn();
    expect(useZoomStore.getState().editorZoomLevel).toBe(1.1);
    zoomOut();
    zoomOut();
    expect(useZoomStore.getState().editorZoomLevel).toBe(0.9);
    resetZoom();
    expect(useZoomStore.getState().editorZoomLevel).toBe(1);
    expect(useZoomStore.getState().terminalZoomLevel).toBe(1);
  });

  it("zooms the terminal when focus is inside the active terminal", () => {
    const container = document.createElement("div");
    container.setAttribute("data-terminal-container", "active");
    const input = document.createElement("textarea");
    container.appendChild(input);
    document.body.appendChild(container);
    input.focus();

    zoomIn();
    expect(useZoomStore.getState().terminalZoomLevel).toBe(1.1);
    expect(useZoomStore.getState().editorZoomLevel).toBe(1);
    resetZoom();
    expect(useZoomStore.getState().terminalZoomLevel).toBe(1);
  });

  it("zooms the active browser page instead of the editor", async () => {
    useBufferStore.getState().actions.openBrowserBuffer("https://example.com");
    const browserId = useBufferStore.getState().actions.getActiveBuffer()?.id;

    zoomIn();
    await vi.waitFor(() => expect(browserManager.zoom).toHaveBeenCalledTimes(1));
    zoomOut();
    await vi.waitFor(() => expect(browserManager.zoom).toHaveBeenCalledTimes(2));
    resetZoom();

    await vi.waitFor(() => expect(browserManager.zoom).toHaveBeenCalledTimes(3));
    expect(browserManager.zoom.mock.calls).toEqual([
      [browserId, 1],
      [browserId, -1],
      [browserId, 0],
    ]);
    expect(useZoomStore.getState().editorZoomLevel).toBe(1);
  });
});

// @vitest-environment jsdom
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

import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/services/workspace-session-repository";
import { createModalSlice, type ModalSlice } from "../stores/ui-state/modal-slice";
import { createPanelSlice, type PanelSlice } from "../stores/ui-state/panel-slice";
import { useZoomStore } from "../stores/zoom.store";

const createModalStore = () => create<ModalSlice>()(createModalSlice);

const overlayFlags = [
  "isQuickOpenVisible",
  "isCommandPaletteVisible",
  "isGlobalSearchVisible",
  "isBranchManagerVisible",
  "isProjectPickerVisible",
  "isDatabaseConnectionVisible",
] as const;

function openOverlays(store: ReturnType<typeof createModalStore>) {
  return overlayFlags.filter((flag) => store.getState()[flag]);
}

describe("modal slice", () => {
  it("keeps only one overlay open at a time", () => {
    const store = createModalStore();
    const { getState } = store;

    getState().setIsQuickOpenVisible(true);
    expect(openOverlays(store)).toEqual(["isQuickOpenVisible"]);
    getState().setIsCommandPaletteVisible(true);
    expect(openOverlays(store)).toEqual(["isCommandPaletteVisible"]);
    getState().setIsGlobalSearchVisible(true);
    expect(openOverlays(store)).toEqual(["isGlobalSearchVisible"]);
    getState().setIsBranchManagerVisible(true);
    expect(openOverlays(store)).toEqual(["isBranchManagerVisible"]);
    getState().setIsProjectPickerVisible(true);
    expect(openOverlays(store)).toEqual(["isProjectPickerVisible"]);
    expect(getState().projectPickerInitialStep).toBe("picker");
    getState().setIsDatabaseConnectionVisible(true);
    expect(openOverlays(store)).toEqual(["isDatabaseConnectionVisible"]);
  });

  it("closes overlays individually", () => {
    const store = createModalStore();
    const setters = [
      ["setIsQuickOpenVisible", "isQuickOpenVisible"],
      ["setIsCommandPaletteVisible", "isCommandPaletteVisible"],
      ["setIsGlobalSearchVisible", "isGlobalSearchVisible"],
      ["setIsBranchManagerVisible", "isBranchManagerVisible"],
      ["setIsProjectPickerVisible", "isProjectPickerVisible"],
      ["setIsDatabaseConnectionVisible", "isDatabaseConnectionVisible"],
    ] as const;

    for (const [setter, flag] of setters) {
      store.getState()[setter](true);
      store.getState()[setter](false);
      expect(store.getState()[flag]).toBe(false);
    }
    expect(store.getState().hasOpenModal()).toBe(false);
  });

  it("opens the command palette on a specific view and resets it on a plain open", () => {
    const store = createModalStore();

    store.getState().setIsQuickOpenVisible(true);
    store.getState().openCommandPaletteView("themes" as never);
    expect(store.getState()).toMatchObject({
      isCommandPaletteVisible: true,
      commandPaletteInitialView: "themes",
      isQuickOpenVisible: false,
    });

    store.getState().setIsCommandPaletteVisible(true);
    expect(store.getState().commandPaletteInitialView).toBe("root");
  });

  it("opens the project picker at a requested step", () => {
    const store = createModalStore();

    store.getState().openProjectPicker("clone" as never);

    expect(store.getState()).toMatchObject({
      isProjectPickerVisible: true,
      projectPickerInitialStep: "clone",
    });
  });

  it("closes the topmost modal first and leaves settings for last", () => {
    const store = createModalStore();
    store.getState().openSettings("editor");
    store.setState({
      isCommandPaletteVisible: true,
      isGlobalSearchVisible: true,
      isQuickOpenVisible: true,
      isProjectPickerVisible: true,
      isBranchManagerVisible: true,
      isDatabaseConnectionVisible: true,
    });
    const closed: string[] = [];

    while (store.getState().hasOpenModal()) {
      const before = { ...store.getState() };
      expect(store.getState().closeTopModal()).toBe(true);
      const flag = [...overlayFlags, "isSettingsVisible" as const].find(
        (key) => before[key] && !store.getState()[key],
      );
      closed.push(flag ?? "none");
    }

    expect(closed).toEqual([
      "isCommandPaletteVisible",
      "isGlobalSearchVisible",
      "isQuickOpenVisible",
      "isProjectPickerVisible",
      "isBranchManagerVisible",
      "isDatabaseConnectionVisible",
      "isSettingsVisible",
    ]);
    expect(store.getState().closeTopModal()).toBe(false);
  });

  it("opens settings on a tab and section, closing overlays", () => {
    const store = createModalStore();
    store.getState().setIsGlobalSearchVisible(true);

    store.getState().openSettings("appearance", "font-size");

    expect(store.getState()).toMatchObject({
      isSettingsVisible: true,
      isGlobalSearchVisible: false,
      settingsInitialTab: "appearance",
      settingsInitialSection: "font-size",
      settingsNavigationRequestId: 1,
    });

    store.getState().openSettings();
    expect(store.getState()).toMatchObject({
      settingsInitialTab: null,
      settingsInitialSection: null,
      settingsNavigationRequestId: 2,
    });

    store.getState().closeSettings();
    expect(store.getState().isSettingsVisible).toBe(false);
  });

  it("bumps the navigation request when the target tab or section changes", () => {
    const store = createModalStore();

    store.getState().setSettingsInitialSection("font");
    store.getState().setSettingsInitialTab("git");

    expect(store.getState()).toMatchObject({
      settingsInitialTab: "git",
      settingsInitialSection: null,
      settingsNavigationRequestId: 2,
    });
  });
});

describe("panel slice", () => {
  const createPanelStore = () =>
    create<PanelSlice>()((set, get, api) => ({
      ...createPanelSlice(set, get, api),
    }));

  beforeEach(() => {
    useProjectStore.setState({ rootFolderPath: "/projects/athas" });
  });

  afterEach(() => {
    useProjectStore.setState({ rootFolderPath: undefined });
  });

  it("remembers panel visibility for the open project", () => {
    const store = createPanelStore();

    store.getState().setIsSidebarVisible(false);
    store.getState().setIsBottomPaneVisible(true);
    store.getState().setBottomPaneActiveTab("diagnostics" as never);

    expect(workspaceSessionRepository.loadUi("/projects/athas")).toMatchObject({
      isSidebarVisible: false,
      isBottomPaneVisible: true,
      bottomPaneActiveTab: "diagnostics",
    });
  });

  it("only changes local state when no project is open", () => {
    useProjectStore.setState({ rootFolderPath: undefined });
    const save = vi.spyOn(workspaceSessionRepository, "saveUi");
    const store = createPanelStore();

    store.getState().setIsSidebarVisible(false);
    store.getState().setIsBottomPaneVisible(true);
    store.getState().setBottomPaneActiveTab("terminal");
    store.getState().setIsFindVisible(true);

    expect(save).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      isSidebarVisible: false,
      isBottomPaneVisible: true,
      isFindVisible: true,
    });
    save.mockRestore();
  });
});

describe("zoom store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useZoomStore.setState({
      editorZoomLevel: 1,
      terminalZoomLevel: 1,
      showZoomIndicator: false,
      zoomIndicatorType: null,
      zoomIndicatorTimeout: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("steps editor and terminal zoom independently", () => {
    const { actions } = useZoomStore.getState();

    actions.zoomIn("editor");
    actions.zoomIn("editor");
    actions.zoomOut("terminal");

    expect(useZoomStore.getState().editorZoomLevel).toBe(1.25);
    expect(actions.getZoomPercentage("editor")).toBe(125);
    expect(actions.getZoomPercentage("terminal")).toBe(90);
  });

  it("stays within the zoom range and only signals real changes", () => {
    const { actions } = useZoomStore.getState();
    useZoomStore.setState({ editorZoomLevel: 3, terminalZoomLevel: 0.5 });

    actions.zoomIn("editor");
    actions.zoomOut("terminal");

    expect(useZoomStore.getState()).toMatchObject({
      editorZoomLevel: 3,
      terminalZoomLevel: 0.5,
      showZoomIndicator: false,
    });

    actions.resetZoom("editor");
    expect(useZoomStore.getState()).toMatchObject({ editorZoomLevel: 1, showZoomIndicator: true });

    useZoomStore.setState({ showZoomIndicator: false });
    actions.resetZoom("editor");
    expect(useZoomStore.getState().showZoomIndicator).toBe(false);
  });

  it("clamps a zoom level above the scale to the largest step", () => {
    const { actions } = useZoomStore.getState();
    useZoomStore.setState({ editorZoomLevel: 4, terminalZoomLevel: 4 });

    actions.zoomIn("editor");
    actions.zoomOut("terminal");

    expect(useZoomStore.getState()).toMatchObject({ editorZoomLevel: 3, terminalZoomLevel: 3 });
  });

  it("snaps an in-between zoom level onto the scale", () => {
    const { actions } = useZoomStore.getState();
    useZoomStore.setState({ editorZoomLevel: 1.05 });

    actions.zoomOut("editor");

    expect(useZoomStore.getState().editorZoomLevel).toBe(1);
  });

  it("shows the zoom indicator briefly and restarts it on repeated zooms", () => {
    const { actions } = useZoomStore.getState();

    actions.zoomIn("terminal");
    expect(useZoomStore.getState()).toMatchObject({
      showZoomIndicator: true,
      zoomIndicatorType: "terminal",
    });

    vi.advanceTimersByTime(1_000);
    actions.zoomIn("editor");
    vi.advanceTimersByTime(1_000);
    expect(useZoomStore.getState()).toMatchObject({
      showZoomIndicator: true,
      zoomIndicatorType: "editor",
    });

    vi.advanceTimersByTime(500);
    expect(useZoomStore.getState()).toMatchObject({
      showZoomIndicator: false,
      zoomIndicatorType: null,
      zoomIndicatorTimeout: null,
    });
  });
});

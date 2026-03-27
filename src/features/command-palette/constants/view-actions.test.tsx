import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";

describe("createViewActions", () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      window: {
        __TAURI_INTERNALS__: {
          invoke: async () => null,
        },
        __TAURI_OS_PLUGIN_INTERNALS__: {
          platform: "linux",
        },
      },
    });
  });

  test("includes an Open Harness action that opens the harness tab and closes the palette", async () => {
    const { createViewActions } = await import("./view-actions");
    let openedHarnessSessionId: string | undefined;
    let openedHarnessBackend: string | undefined;
    let createdHarnessSession = false;
    let closedPalette = false;

    const actions = createViewActions({
      isHarnessActive: false,
      isSidebarVisible: true,
      setIsSidebarVisible: () => {},
      isBottomPaneVisible: false,
      setIsBottomPaneVisible: () => {},
      bottomPaneActiveTab: "terminal",
      setBottomPaneActiveTab: () => {},
      isFindVisible: false,
      setIsFindVisible: () => {},
      settings: {
        sidebarPosition: "left",
        nativeMenuBar: false,
        compactMenuBar: false,
      },
      updateSetting: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
      resetZoom: () => {},
      createAgentBuffer: () => {
        createdHarnessSession = true;
      },
      openAgentBuffer: (sessionId, options) => {
        openedHarnessSessionId = sessionId;
        openedHarnessBackend = options?.backend;
      },
      openWebViewerBuffer: () => {},
      onClose: () => {
        closedPalette = true;
      },
    });

    const openHarnessAction = actions.find((action) => action.id === "open-harness");

    expect(openHarnessAction).toBeDefined();
    expect(openHarnessAction?.label).toBe("View: Open Harness");
    openHarnessAction?.action();
    expect(openedHarnessSessionId).toBe(DEFAULT_HARNESS_SESSION_KEY);
    expect(openedHarnessBackend).toBe("pi-native");
    expect(createdHarnessSession).toBe(false);
    expect(closedPalette).toBe(true);
  });

  test("includes a New Harness Session action that creates a session and closes the palette", async () => {
    const { createViewActions } = await import("./view-actions");
    let openedHarness = false;
    let createdHarnessSession = false;
    let closedPalette = false;

    const actions = createViewActions({
      isHarnessActive: false,
      isSidebarVisible: true,
      setIsSidebarVisible: () => {},
      isBottomPaneVisible: false,
      setIsBottomPaneVisible: () => {},
      bottomPaneActiveTab: "terminal",
      setBottomPaneActiveTab: () => {},
      isFindVisible: false,
      setIsFindVisible: () => {},
      settings: {
        sidebarPosition: "left",
        nativeMenuBar: false,
        compactMenuBar: false,
      },
      updateSetting: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
      resetZoom: () => {},
      createAgentBuffer: () => {
        createdHarnessSession = true;
      },
      openAgentBuffer: () => {
        openedHarness = true;
      },
      openWebViewerBuffer: () => {},
      onClose: () => {
        closedPalette = true;
      },
    });

    const newHarnessSessionAction = actions.find((action) => action.id === "new-harness-session");

    expect(newHarnessSessionAction).toBeDefined();
    expect(newHarnessSessionAction?.label).toBe("View: New Harness Session");
    newHarnessSessionAction?.action();
    expect(createdHarnessSession).toBe(true);
    expect(openedHarness).toBe(false);
    expect(closedPalette).toBe(true);
  });
});

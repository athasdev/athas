import { describe, expect, test } from "bun:test";
import { createViewActions } from "./view-actions";

describe("createViewActions", () => {
  test("includes an Open Harness action that opens the harness tab and closes the palette", () => {
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

    const openHarnessAction = actions.find((action) => action.id === "open-harness");

    expect(openHarnessAction).toBeDefined();
    expect(openHarnessAction?.label).toBe("View: Open Harness");
    openHarnessAction?.action();
    expect(openedHarness).toBe(true);
    expect(createdHarnessSession).toBe(false);
    expect(closedPalette).toBe(true);
  });

  test("includes a New Harness Session action that creates a session and closes the palette", () => {
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

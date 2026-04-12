import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useZoomStore } from "./zoom-store";

describe("zoom store", () => {
  beforeEach(() => {
    const existingTimeout = useZoomStore.getState().zoomIndicatorTimeout;
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    useZoomStore.setState({
      editorZoomLevel: 1,
      terminalZoomLevel: 1,
      showZoomIndicator: false,
      zoomIndicatorType: null,
      zoomIndicatorTimeout: null,
    });
  });

  it("uses finer zoom-out steps for the terminal", () => {
    const { zoomOut } = useZoomStore.getState().actions;

    zoomOut("terminal");
    expect(useZoomStore.getState().terminalZoomLevel).toBe(0.9);

    zoomOut("terminal");
    expect(useZoomStore.getState().terminalZoomLevel).toBe(0.8);

    zoomOut("terminal");
    expect(useZoomStore.getState().terminalZoomLevel).toBe(0.7);

    zoomOut("terminal");
    expect(useZoomStore.getState().terminalZoomLevel).toBe(0.6);

    zoomOut("terminal");
    expect(useZoomStore.getState().terminalZoomLevel).toBe(0.5);
  });

  it("keeps editor zoom levels unchanged", () => {
    const { zoomOut } = useZoomStore.getState().actions;

    zoomOut("editor");
    expect(useZoomStore.getState().editorZoomLevel).toBe(0.9);

    zoomOut("editor");
    expect(useZoomStore.getState().editorZoomLevel).toBe(0.75);
  });
});

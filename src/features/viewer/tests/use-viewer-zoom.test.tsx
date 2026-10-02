// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { useViewerZoom, type UseViewerZoomOptions } from "../hooks/use-viewer-zoom";

type Zoom = ReturnType<typeof useViewerZoom>;

let container: HTMLDivElement;
let root: Root;
let zoom: Zoom;

function Harness({ options }: { options?: UseViewerZoomOptions }) {
  zoom = useViewerZoom(options);
  return null;
}

async function render(options?: UseViewerZoomOptions) {
  await act(async () => root.render(<Harness options={options} />));
}

function wheel(init: WheelEventInit) {
  const event = new WheelEvent("wheel", { cancelable: true, ...init });
  act(() => zoom.handleWheel(event));
  return event;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("viewer zoom", () => {
  it("steps in and out by ten percent and resets to the initial zoom", async () => {
    await render({ initialZoom: 1 });

    act(() => zoom.zoomIn());
    act(() => zoom.zoomIn());
    expect(zoom.zoom).toBeCloseTo(1.2);

    act(() => zoom.zoomOut());
    expect(zoom.zoom).toBeCloseTo(1.1);

    act(() => zoom.resetZoom());
    expect(zoom.zoom).toBe(1);
  });

  it("stays within the configured bounds", async () => {
    await render({ initialZoom: 0.5, minZoom: 0.5, maxZoom: 0.6 });

    act(() => zoom.zoomOut());
    expect(zoom.zoom).toBe(0.5);

    act(() => zoom.zoomIn());
    act(() => zoom.zoomIn());
    expect(zoom.zoom).toBe(0.6);
  });

  it("zooms with ctrl or cmd plus wheel and lets plain scrolling through", async () => {
    await render();

    const plain = wheel({ deltaY: -100 });
    expect(plain.defaultPrevented).toBe(false);
    expect(zoom.zoom).toBe(1);

    const pinchOut = wheel({ deltaY: -100, ctrlKey: true });
    expect(pinchOut.defaultPrevented).toBe(true);
    expect(zoom.zoom).toBeCloseTo(1.1);

    wheel({ deltaY: 200, metaKey: true });
    expect(zoom.zoom).toBeCloseTo(0.9);
  });

  it("clamps wheel zoom to the bounds", async () => {
    await render({ maxZoom: 2, minZoom: 0.5 });

    wheel({ deltaY: -10_000, ctrlKey: true });
    expect(zoom.zoom).toBe(2);

    wheel({ deltaY: 10_000, ctrlKey: true });
    expect(zoom.zoom).toBe(0.5);
  });
});

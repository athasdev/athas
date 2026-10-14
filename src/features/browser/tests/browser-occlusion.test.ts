// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type BrowserRect,
  collectPaintedRects,
  getLocalHoles,
  isRectCovered,
  isSlotShown,
  scanOverlays,
  subtractRects,
} from "../utils/browser-occlusion";

function area(rects: BrowserRect[]) {
  return rects.reduce((total, rect) => total + rect.width * rect.height, 0);
}

function place(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  element.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) as DOMRect;
  return element;
}

function painted(rect: { left: number; top: number; width: number; height: number }) {
  const element = document.createElement("div");
  element.style.backgroundColor = "rgb(20, 20, 20)";
  return place(element, rect) as HTMLElement;
}

describe("browser page geometry", () => {
  const page = { x: 0, y: 0, width: 100, height: 80 };

  it("keeps the whole page when no hole touches it", () => {
    expect(subtractRects(page, [{ x: 200, y: 0, width: 10, height: 10 }])).toEqual([page]);
  });

  it("leaves the parts around a hole, without overlaps", () => {
    const pieces = subtractRects(page, [{ x: 40, y: 30, width: 20, height: 10 }]);

    expect(pieces).toHaveLength(4);
    expect(area(pieces)).toBe(100 * 80 - 20 * 10);
  });

  it("handles holes that overlap each other", () => {
    const pieces = subtractRects(page, [
      { x: 0, y: 0, width: 60, height: 40 },
      { x: 30, y: 20, width: 60, height: 40 },
    ]);

    expect(area(pieces)).toBe(100 * 80 - (60 * 40 + 60 * 40 - 30 * 20));
  });

  it("knows when holes cover the whole page", () => {
    expect(isRectCovered(page, [])).toBe(false);
    expect(isRectCovered(page, [{ x: 0, y: 0, width: 50, height: 80 }])).toBe(false);
    expect(
      isRectCovered(page, [
        { x: 0, y: 0, width: 50, height: 80 },
        { x: 50, y: 0, width: 50, height: 80 },
      ]),
    ).toBe(true);
  });

  it("turns overlays into holes relative to the page, rounded outwards", () => {
    const geometry = { x: 100, y: 50, width: 400, height: 300 };
    const holes = getLocalHoles(geometry, [
      { x: 450.4, y: 40, width: 100, height: 30.2 },
      { x: 450.4, y: 40, width: 100, height: 30.2 },
      { x: 0, y: 0, width: 50, height: 50 },
    ]);

    expect(holes).toEqual([{ x: 350, y: 0, width: 50, height: 21 }]);
  });

  it("merges a crowd of holes into one", () => {
    const geometry = { x: 0, y: 0, width: 1000, height: 1000 };
    const overlays = Array.from({ length: 40 }, (_, index) => ({
      x: index * 20,
      y: index * 10,
      width: 10,
      height: 10,
    }));

    expect(getLocalHoles(geometry, overlays)).toEqual([{ x: 0, y: 0, width: 790, height: 400 }]);
  });
});

describe("workbench UI over browser pages", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    document.elementFromPoint = (() => null) as typeof document.elementFromPoint;
  });

  it("looks through wrappers that only position what they hold", () => {
    const positioner = place(document.createElement("div"), {
      left: 0,
      top: 0,
      width: 1200,
      height: 800,
    });
    const popup = painted({ left: 100, top: 100, width: 200, height: 120 });
    positioner.append(popup);

    expect(collectPaintedRects(positioner)).toEqual([{ x: 100, y: 100, width: 200, height: 120 }]);
  });

  it("skips UI that is not drawn, but counts a popup about to fade in", () => {
    const root = document.createElement("div");
    const gone = painted({ left: 0, top: 0, width: 10, height: 10 });
    gone.style.display = "none";
    const invisible = painted({ left: 0, top: 0, width: 10, height: 10 });
    invisible.style.opacity = "0";
    const entering = painted({ left: 20, top: 0, width: 10, height: 10 });
    entering.style.opacity = "0";
    entering.setAttribute("data-starting-style", "");
    const clear = place(document.createElement("div"), { left: 40, top: 0, width: 10, height: 10 });
    (clear as HTMLElement).style.backgroundColor = "oklch(0.2 0.01 250 / 0)";
    root.append(gone, invisible, entering, clear);

    expect(collectPaintedRects(root)).toEqual([{ x: 20, y: 0, width: 10, height: 10 }]);
  });

  it("finds popups in portals and toasts inside the app, but not the app itself", () => {
    const root = document.getElementById("root") as HTMLElement;
    root.style.backgroundColor = "rgb(0, 0, 0)";
    place(root, { left: 0, top: 0, width: 1200, height: 800 });
    const slot = place(document.createElement("div"), {
      left: 100,
      top: 100,
      width: 600,
      height: 400,
    }) as HTMLElement;
    const toaster = document.createElement("ol");
    toaster.setAttribute("data-sonner-toaster", "");
    toaster.append(painted({ left: 600, top: 700, width: 300, height: 60 }));
    root.append(slot, toaster);
    const portal = document.createElement("div");
    portal.append(painted({ left: 650, top: 120, width: 180, height: 200 }));
    document.body.append(portal);

    const scan = scanOverlays(
      [{ element: slot, geometry: { x: 100, y: 100, width: 600, height: 400 } }],
      false,
    );

    expect(scan.rects).toEqual([
      { x: 650, y: 120, width: 180, height: 200 },
      { x: 600, y: 700, width: 300, height: 60 },
    ]);
  });

  it("hit tests the page for app UI floating over it and follows it on later frames", () => {
    const root = document.getElementById("root") as HTMLElement;
    const pane = document.createElement("div");
    const slot = place(document.createElement("div"), {
      left: 0,
      top: 0,
      width: 400,
      height: 300,
    }) as HTMLElement;
    const column = place(document.createElement("div"), {
      left: 300,
      top: 0,
      width: 100,
      height: 300,
    });
    const card = painted({ left: 310, top: 10, width: 80, height: 40 });
    const label = place(document.createElement("span"), {
      left: 320,
      top: 20,
      width: 40,
      height: 10,
    });
    card.append(label);
    column.append(card);
    pane.append(slot, column);
    root.append(pane);
    document.elementFromPoint = ((x: number, y: number) =>
      x >= 310 && x <= 390 && y >= 10 && y <= 50
        ? label
        : slot) as typeof document.elementFromPoint;
    const geometry = { x: 0, y: 0, width: 400, height: 300 };

    const sampled = scanOverlays([{ element: slot, geometry }], true);
    expect(sampled.rects).toEqual([{ x: 310, y: 10, width: 80, height: 40 }]);
    expect([...sampled.layers]).toEqual([column]);

    document.elementFromPoint = (() => null) as typeof document.elementFromPoint;
    place(card, { left: 310, top: 60, width: 80, height: 40 });
    const followed = scanOverlays([{ element: slot, geometry }], false, sampled.layers);
    expect(followed.rects).toEqual([{ x: 310, y: 60, width: 80, height: 40 }]);
  });

  it("treats a slot in a hidden layer as not shown, but not one made inert by a modal", () => {
    const root = document.getElementById("root") as HTMLElement;
    const layer = document.createElement("div");
    const slot = document.createElement("div");
    layer.append(slot);
    root.append(layer);
    expect(isSlotShown(slot)).toBe(true);

    root.setAttribute("inert", "");
    expect(isSlotShown(slot)).toBe(true);

    layer.setAttribute("hidden", "");
    expect(isSlotShown(slot)).toBe(false);

    layer.removeAttribute("hidden");
    slot.style.visibility = "hidden";
    expect(isSlotShown(slot)).toBe(false);

    slot.remove();
    slot.style.visibility = "";
    expect(isSlotShown(slot)).toBe(false);
  });
});

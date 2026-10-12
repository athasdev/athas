// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PaneResizeHandle } from "../components/pane-resize-handle";

let root: Root;
let container: HTMLDivElement;
let sizes: [number, number];
let resets = 0;

function Harness({
  direction,
  initial = [50, 50],
  withReset = true,
}: {
  direction: "horizontal" | "vertical";
  initial?: [number, number];
  withReset?: boolean;
}) {
  const [current, setCurrent] = useState<[number, number]>(initial);
  sizes = current;
  return (
    <div data-pane-split-container="true">
      <div data-testid="first" />
      <PaneResizeHandle
        direction={direction}
        initialSizes={current}
        resizeHandleCount={1}
        onResize={setCurrent}
        onReset={
          withReset
            ? () => {
                resets++;
                setCurrent([50, 50]);
              }
            : undefined
        }
      />
      <div data-testid="second" />
    </div>
  );
}

async function render(
  direction: "horizontal" | "vertical",
  options: { initial?: [number, number]; withReset?: boolean } = {},
) {
  await act(async () => root.render(<Harness direction={direction} {...options} />));
}

const handle = () => within(container).getByRole("separator", { name: "Resize panes" });
const pane = (id: string) => within(container).getByTestId(id);

async function key(value: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(handle(), { key: value, ...init });
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  resets = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const size = this.dataset.paneSplitContainer ? 1000 : 0;
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: size,
      height: size,
      right: size,
      bottom: size,
      toJSON() {},
    } as DOMRect;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pane resize handle", () => {
  it("exposes the split position and its limits to assistive technology", async () => {
    await render("horizontal", { initial: [30, 70] });
    expect(handle().getAttribute("aria-orientation")).toBe("vertical");
    expect(handle().getAttribute("aria-valuenow")).toBe("30");
    expect(handle().getAttribute("aria-valuemin")).toBe("10");
    expect(handle().getAttribute("aria-valuemax")).toBe("90");

    await render("vertical");
    expect(handle().getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("resizes from the keyboard in small, large and edge steps", async () => {
    await render("horizontal");
    await key("ArrowRight");
    expect(sizes).toEqual([52, 48]);
    await key("ArrowLeft", { shiftKey: true });
    expect(sizes).toEqual([42, 58]);
    await key("Home");
    expect(sizes).toEqual([10, 90]);
    await key("End");
    expect(sizes).toEqual([90, 10]);
    await key("Enter");
    expect(sizes).toEqual([50, 50]);
    expect(resets).toBe(1);
    await key("Tab");
    expect(sizes).toEqual([50, 50]);
  });

  it("uses up and down arrows for a vertical split and ignores Enter without a reset", async () => {
    await render("vertical", { withReset: false });
    await key("ArrowDown");
    expect(sizes).toEqual([52, 48]);
    await key("ArrowUp");
    await key("ArrowUp");
    expect(sizes).toEqual([48, 52]);
    await key("ArrowRight");
    await key("Enter");
    expect(sizes).toEqual([48, 52]);
  });

  it("drags the split, previews the panes and commits on release", async () => {
    await render("horizontal");
    await act(async () => {
      fireEvent.mouseDown(handle(), { button: 0, clientX: 500, clientY: 0 });
    });
    expect(document.body.style.cursor).toBe("col-resize");

    await act(async () => {
      fireEvent.mouseMove(document, { clientX: 700, clientY: 0 });
    });
    expect(pane("first").style.flexGrow).toBe("70");
    expect(pane("second").style.flexGrow).toBe("30");
    expect(sizes).toEqual([50, 50]);

    await act(async () => {
      fireEvent.mouseUp(document);
    });
    expect(sizes).toEqual([70, 30]);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("drags a vertical split by the pointer's height and ends when the window loses focus", async () => {
    await render("vertical");
    await act(async () => {
      fireEvent.mouseDown(handle(), { button: 0, clientX: 0, clientY: 500 });
    });
    expect(document.body.style.cursor).toBe("row-resize");
    await act(async () => {
      fireEvent.mouseMove(document, { clientX: 0, clientY: 100 });
    });
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(sizes).toEqual([10, 90]);
  });

  it("ignores other mouse buttons, releases without movement and resets on double click", async () => {
    await render("horizontal", { initial: [20, 80] });
    await act(async () => {
      fireEvent.mouseDown(handle(), { button: 2, clientX: 500 });
    });
    expect(document.body.style.cursor).toBe("");

    await act(async () => {
      fireEvent.mouseDown(handle(), { button: 0, clientX: 500 });
    });
    await key("ArrowRight");
    expect(sizes).toEqual([20, 80]);
    await act(async () => {
      fireEvent.mouseUp(document);
    });
    expect(sizes).toEqual([20, 80]);

    await act(async () => {
      fireEvent.doubleClick(handle());
    });
    expect(sizes).toEqual([50, 50]);
  });
});

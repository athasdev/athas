// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";

const settings = vi.hoisted(() => ({ showMinimap: true }));

vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (value: unknown) => unknown) => selector({ settings }),
}));

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
HTMLCanvasElement.prototype.getContext = (() => null) as never;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { CodeMirrorMinimap } =
  await import("../engines/codemirror/features/minimap/codemirror-minimap");

let container: HTMLDivElement;
let root: Root;
let view: EditorView;

function render() {
  const host = { view } as CodeMirrorHost;
  act(() => root.render(<CodeMirrorMinimap host={host} />));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  view = new EditorView({
    parent: container,
    state: EditorState.create({ doc: "const a = 1;\n".repeat(50) }),
  });
  root = createRoot(document.createElement("div"));
  settings.showMinimap = true;
});

afterEach(() => {
  act(() => root.unmount());
  view.destroy();
  container.remove();
  vi.restoreAllMocks();
});

describe("CodeMirror minimap", () => {
  it("shows the minimap while the setting is on", () => {
    render();
    expect(view.dom.querySelector(".cm-minimap-gutter")).not.toBeNull();

    settings.showMinimap = false;
    render();
    expect(view.dom.querySelector(".cm-minimap-gutter")).toBeNull();
  });

  it("stays hidden while the setting is off", () => {
    settings.showMinimap = false;
    render();
    expect(view.dom.querySelector(".cm-minimap-gutter")).toBeNull();
  });

  it("removes the window listeners the minimap slider leaves behind", () => {
    const added: Array<[string, unknown]> = [];
    const removed: Array<[string, unknown]> = [];
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListener,
      options?: boolean | AddEventListenerOptions,
    ) => {
      added.push([type, listener]);
      add(type, listener, options);
    }) as typeof window.addEventListener);
    vi.spyOn(window, "removeEventListener").mockImplementation(((
      type: string,
      listener: EventListener,
      options?: boolean | EventListenerOptions,
    ) => {
      removed.push([type, listener]);
      remove(type, listener, options);
    }) as typeof window.addEventListener);

    render();
    const sliderListeners = added.filter(([type]) => type === "mouseup" || type === "mousemove");
    expect(sliderListeners).toHaveLength(2);

    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    for (const listener of sliderListeners) expect(removed).toContainEqual(listener);
  });
});

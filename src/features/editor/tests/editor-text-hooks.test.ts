// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
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

import type { EditorContent, PaneContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import {
  useBufferText,
  useBuffersTextRevision,
  useOpenBuffersIgnoringText,
} from "../hooks/use-buffer-text";
import { useSelectionScope } from "../hooks/use-selection-scope";
import { useBufferStore } from "../stores/buffer.store";

let root: Root;

function renderHook<P, T>(useHook: (props: P) => T, initialProps: NoInfer<P>) {
  const result = {} as { current: T; renders: number };
  result.renders = 0;
  let props = initialProps;
  function Probe() {
    result.renders += 1;
    result.current = useHook(props);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    result,
    rerender: (next: P) => {
      props = next;
      act(() => root.render(createElement(Probe)));
    },
  };
}

function editor(id: string, content: string, revision = 0): EditorContent {
  return {
    id,
    type: "editor",
    path: `/ws/${id}.ts`,
    name: `${id}.ts`,
    content,
    savedContent: content,
    contentRevision: revision,
    isDirty: false,
    isVirtual: false,
    language: "typescript",
  };
}

const edit = (id: string, content: string) =>
  act(() => useBufferStore.getState().actions.updateBufferContent(id, content));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  workspaceRuntimeRegistry.resetForTests();
  document.body.innerHTML = "";
  document.body.className = "";
  vi.useRealTimers();
});

describe("useBufferText", () => {
  it("follows the buffer's text immediately without a debounce", () => {
    useBufferStore.setState({ buffers: [editor("a", "one")] });
    const { result } = renderHook((id: string | null) => useBufferText(id), "a");
    expect(result.current).toBe("one");

    edit("a", "two");
    expect(result.current).toBe("two");
  });

  it("waits for edits to pause, but switches buffers at once", () => {
    vi.useFakeTimers();
    useBufferStore.setState({ buffers: [editor("a", "one"), editor("b", "bee")] });
    const { result, rerender } = renderHook(
      (id: string | null) => useBufferText(id, { debounceMs: 200 }),
      "a",
    );

    edit("a", "two");
    act(() => vi.advanceTimersByTime(150));
    edit("a", "three");
    act(() => vi.advanceTimersByTime(150));
    expect(result.current).toBe("one");
    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe("three");

    rerender("b");
    expect(result.current).toBe("bee");
  });

  it("returns stored text for preview buffers and nothing without a buffer", () => {
    useBufferStore.setState({
      buffers: [
        {
          id: "preview",
          type: "markdownPreview",
          path: "preview://a.md",
          name: "a.md",
          content: "# Title",
          sourceFilePath: "/ws/a.md",
        } as PaneContent,
      ],
    });
    const { result, rerender } = renderHook((id: string | null) => useBufferText(id), "preview");
    expect(result.current).toBe("# Title");

    rerender(null);
    expect(result.current).toBe("");
    rerender("missing");
    expect(result.current).toBe("");
  });
});

describe("useOpenBuffersIgnoringText", () => {
  it("keeps the same list while only text changes", () => {
    useBufferStore.setState({ buffers: [editor("a", "one"), editor("b", "two")] });
    const { result } = renderHook((enabled: boolean) => useOpenBuffersIgnoringText(enabled), true);
    const first = result.current;

    act(() => useBufferStore.getState().actions.updateBufferContent("a", "reloaded", false));
    expect(result.current).toBe(first);

    act(() =>
      useBufferStore.setState((state) => ({
        buffers: state.buffers.map((buffer) =>
          buffer.id === "b" ? { ...buffer, name: "renamed.ts" } : buffer,
        ),
      })),
    );
    expect(result.current).not.toBe(first);
    expect(result.current.map((buffer) => buffer.name)).toEqual(["a.ts", "renamed.ts"]);

    act(() => useBufferStore.setState({ buffers: [editor("a", "x")] }));
    expect(result.current).toHaveLength(1);
  });

  it("returns no buffers when disabled", () => {
    useBufferStore.setState({ buffers: [editor("a", "one")] });
    const { result } = renderHook((enabled: boolean) => useOpenBuffersIgnoringText(enabled), false);
    expect(result.current).toEqual([]);
  });
});

describe("useBuffersTextRevision", () => {
  it("changes when any watched buffer's text changes", () => {
    useBufferStore.setState({
      buffers: [
        editor("a", "one"),
        editor("c", "see"),
        {
          id: "diff",
          type: "diff",
          path: "diff://a",
          name: "a.diff",
          content: "+a",
        } as PaneContent,
      ],
    });
    const { result, rerender } = renderHook(
      (ids: Set<string>) => useBuffersTextRevision(ids),
      new Set(["a", "diff", "missing"]),
    );
    const initial = result.current;

    edit("c", "unwatched edit");
    expect(result.current).toBe(initial);

    edit("a", "two");
    const afterEdit = result.current;
    expect(afterEdit).not.toBe(initial);

    edit("diff", "+b");
    expect(result.current).not.toBe(afterEdit);

    rerender(new Set());
    expect(result.current).toBe("|");
  });

  it("settles rapid changes before reporting them", () => {
    vi.useFakeTimers();
    useBufferStore.setState({ buffers: [editor("a", "one")] });
    const ids = new Set(["a"]);
    const { result } = renderHook(
      (watched: Set<string>) => useBuffersTextRevision(watched, 100),
      ids,
    );
    const initial = result.current;

    edit("a", "two");
    expect(result.current).toBe(initial);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).not.toBe(initial);
  });
});

describe("useSelectionScope", () => {
  function mountScope(enabled: boolean) {
    const host = document.createElement("div");
    const excluded = document.createElement("button");
    excluded.setAttribute("data-selection-scope-exclude", "true");
    host.appendChild(excluded);
    document.body.appendChild(host);
    const hook = renderHook((isEnabled: boolean) => {
      const ref = useRef<HTMLElement | null>(host);
      useSelectionScope(ref, isEnabled);
    }, enabled);
    return { host, excluded, ...hook };
  }

  const isActive = (host: HTMLElement) =>
    host.hasAttribute("data-selection-scope-active") &&
    document.body.classList.contains("selection-scope-active");

  it("scopes text selection to the element while the primary button is held", () => {
    const { host, excluded } = mountScope(true);
    expect(host.getAttribute("data-selection-scope-root")).toBe("true");

    host.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
    expect(isActive(host)).toBe(false);
    excluded.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    expect(isActive(host)).toBe(false);

    host.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    expect(isActive(host)).toBe(true);
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(isActive(host)).toBe(false);

    for (const end of [
      () => window.dispatchEvent(new Event("blur")),
      () => document.dispatchEvent(new Event("visibilitychange")),
      () => document.dispatchEvent(new Event("dragend")),
    ]) {
      host.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
      end();
      expect(isActive(host)).toBe(false);
    }
  });

  it("cleans up its markers when disabled", () => {
    const { host, rerender } = mountScope(true);
    host.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));

    rerender(false);

    expect(host.hasAttribute("data-selection-scope-root")).toBe(false);
    expect(isActive(host)).toBe(false);
    host.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    expect(isActive(host)).toBe(false);
  });
});

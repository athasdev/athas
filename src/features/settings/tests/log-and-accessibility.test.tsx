// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const events = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  unlistened: [] as string[],
  syncTransparency: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: () => void) => {
    events.handlers.set(name, handler);
    return () => events.unlistened.push(name);
  }),
}));
vi.mock("@/features/settings/lib/settings-effects", () => ({
  syncEffectiveWindowTransparency: events.syncTransparency,
}));

import { commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useSystemAccessibility } from "../hooks/use-system-accessibility";
import { openAthasLogBuffer } from "../services/athas-log-service";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mediaQueries = new Map<string, { matches: boolean; listeners: Set<() => void> }>();

function stubMatchMedia(matches: Record<string, boolean> = {}) {
  mediaQueries.clear();
  window.matchMedia = ((query: string) => {
    const entry = { matches: matches[query] ?? false, listeners: new Set<() => void>() };
    mediaQueries.set(query, entry);
    return {
      get matches() {
        return entry.matches;
      },
      addEventListener: (...args: [string, () => void]) => entry.listeners.add(args[1]),
      removeEventListener: (...args: [string, () => void]) => entry.listeners.delete(args[1]),
    };
  }) as unknown as typeof window.matchMedia;
}

const attr = (name: string) => document.documentElement.getAttribute(name);

beforeEach(() => {
  events.handlers.clear();
  events.unlistened = [];
  events.syncTransparency.mockClear();
  workspaceRuntimeRegistry.resetForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  workspaceRuntimeRegistry.resetForTests();
});

describe("useSystemAccessibility", () => {
  function mount() {
    function Probe() {
      useSystemAccessibility();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    return () => act(() => root.unmount());
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("mirrors native accessibility preferences onto the document", async () => {
    stubMatchMedia();
    vi.spyOn(commands, "getSystemAccessibilityPreferences").mockResolvedValue({
      reduceTransparency: true,
      increaseContrast: false,
      differentiateWithoutColor: true,
      reduceMotion: true,
    });

    const unmount = mount();
    await settle();

    expect(attr("data-reduce-transparency")).toBe("true");
    expect(attr("data-increase-contrast")).toBe("false");
    expect(attr("data-differentiate-without-color")).toBe("true");
    expect(events.syncTransparency).toHaveBeenCalled();
    unmount();
    await settle();
    expect(events.unlistened).toEqual(["system_accessibility_changed"]);
  });

  it("falls back to media queries and resyncs on system changes", async () => {
    stubMatchMedia({ "(prefers-contrast: more)": true });
    const preferences = vi
      .spyOn(commands, "getSystemAccessibilityPreferences")
      .mockRejectedValue(new Error("not supported"));

    const unmount = mount();
    await settle();
    expect(attr("data-increase-contrast")).toBe("true");
    expect(attr("data-reduce-transparency")).toBe("false");

    const transparency = mediaQueries.get("(prefers-reduced-transparency: reduce)")!;
    transparency.matches = true;
    for (const listener of transparency.listeners) listener();
    await settle();
    expect(attr("data-reduce-transparency")).toBe("true");

    window.dispatchEvent(new Event("focus"));
    events.handlers.get("system_accessibility_changed")?.();
    await settle();
    expect(preferences).toHaveBeenCalledTimes(4);

    unmount();
    expect(transparency.listeners.size).toBe(0);
  });
});

describe("openAthasLogBuffer", () => {
  it("opens the log read-only and scrolls to the requested line", async () => {
    const content = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
    vi.spyOn(commands, "readAthasLog").mockResolvedValue({
      path: "/Users/dev/Library/Logs/Athas/Athas.log",
      content,
      target_line: 20,
      truncated: true,
    });

    const logFile = await openAthasLogBuffer();

    expect(logFile).toEqual({
      path: "/Users/dev/Library/Logs/Athas/Athas.log",
      content,
      targetLine: 20,
      truncated: true,
    });
    const buffer = useBufferStore
      .getState()
      .buffers.find((candidate) => candidate.path === logFile.path);
    expect(buffer).toMatchObject({
      type: "editor",
      name: "Athas.log",
      readOnly: true,
      isDirty: false,
      language: "log",
    });
    const viewState = useEditorStateStore.getState().actions.getCachedViewState(buffer!.id);
    expect(viewState?.cursor).toEqual({ line: 20, column: 0, offset: content.indexOf("line 20") });
    expect(viewState?.scrollTop).toBeGreaterThan(0);
    const pane = usePaneStore.getState().actions.getActivePane();
    expect(
      useEditorStateStore.getState().actions.getCachedViewState(`${pane!.id}:${buffer!.id}`),
    ).toEqual(viewState);
  });

  it("clamps the target line to the end of a short log", async () => {
    vi.spyOn(commands, "readAthasLog").mockResolvedValue({
      path: "C:\\Logs\\short.log",
      content: "only line",
      target_line: 50,
      truncated: false,
    });

    const logFile = await openAthasLogBuffer();
    const buffer = useBufferStore
      .getState()
      .buffers.find((candidate) => candidate.path === logFile.path);

    expect(buffer?.name).toBe("short.log");
    expect(useEditorStateStore.getState().actions.getCachedViewState(buffer!.id)?.cursor).toEqual({
      line: 50,
      column: 0,
      offset: "only line".length,
    });
  });
});

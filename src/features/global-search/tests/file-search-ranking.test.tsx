// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  activeBufferId: null as string | null,
  recentFiles: [] as { path: string; name: string }[],
  snapshot: { key: "k", tokens: [] as unknown[], complete: true },
  load: vi.fn(),
}));

vi.mock("@/features/editor/stores/buffer.store", async () => {
  const { create } = await import("zustand");
  return { useBufferStore: create(() => ({ buffers: [] as unknown[] })) };
});
vi.mock("@/features/file-system/stores/recent-files.store", async () => {
  const { create } = await import("zustand");
  return {
    useRecentFilesStore: create(() => ({
      actions: { getRecentFilesOrderedByFrecency: () => harness.recentFiles },
    })),
  };
});
vi.mock("@/features/panes/hooks/use-pane-buffer-state", () => ({
  useActiveBufferId: () => harness.activeBufferId,
}));
vi.mock("../services/search-excerpt-syntax", () => ({
  getSearchExcerptTokenSnapshot: () => harness.snapshot,
  loadSearchExcerptTokens: harness.load,
}));

import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { FileItem } from "@/features/file-search/types/file-search.types";
import { useFileSearch } from "../hooks/use-file-search";
import { useSearchExcerptTokens } from "../hooks/use-search-excerpt-tokens";
import { subsequenceFuzzyScore } from "../services/subsequence-fuzzy-score";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function renderHook<P, T>(useHook: (props: P) => T, props: P) {
  const result = {} as { current: T };
  function Probe({ value }: { value: P }) {
    result.current = useHook(value);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe, { value: props })));
  return {
    result,
    rerender: (next: P) => act(() => root.render(createElement(Probe, { value: next }))),
    unmount: () => act(() => root.unmount()),
  };
}

const file = (path: string): FileItem => ({
  name: path.split("/").pop() ?? path,
  path,
  isDir: false,
});

const bufferStore = useBufferStore as unknown as { setState: (state: object) => void };

beforeEach(() => {
  harness.activeBufferId = null;
  harness.recentFiles = [];
  harness.load.mockReset();
  bufferStore.setState({ buffers: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subsequenceFuzzyScore", () => {
  it("prefers exact, prefix and substring matches", () => {
    expect(subsequenceFuzzyScore("readme.md", "")).toBe(0);
    expect(subsequenceFuzzyScore("README.md", "readme.md")).toBe(1000);
    expect(subsequenceFuzzyScore("README.md", "read")).toBe(800);
    expect(subsequenceFuzzyScore("src/README.md", "readme")).toBe(600);
  });

  it("scores scattered matches by consecutive runs and text length", () => {
    const tight = subsequenceFuzzyScore("button.tsx", "btn");
    const loose = subsequenceFuzzyScore("big-table-notes.tsx", "btn");

    expect(tight).toBeGreaterThan(0);
    expect(loose).toBeGreaterThan(0);
    expect(tight).toBeGreaterThan(loose);
    expect(subsequenceFuzzyScore("abc", "abd")).toBe(0);
    expect(subsequenceFuzzyScore("a-bc", "abc")).toBe(10 + 10 + 14 + 96);
  });
});

describe("useFileSearch", () => {
  it("lists open buffers, recent files and the rest by name, leaving out the active file", () => {
    bufferStore.setState({
      buffers: [
        { id: "b1", path: "/repo/open.ts", type: "editor" },
        { id: "b2", path: "/repo/active.ts", type: "editor" },
      ],
    });
    harness.activeBufferId = "b2";
    harness.recentFiles = [file("/repo/recent-b.ts"), file("/repo/recent-a.ts")];
    const files = [
      file("/repo/zeta.ts"),
      file("/repo/recent-a.ts"),
      file("/repo/open.ts"),
      file("/repo/alpha.ts"),
      file("/repo/recent-b.ts"),
      file("/repo/active.ts"),
    ];

    const { result } = renderHook(() => useFileSearch(files, "  "), {});

    expect(result.current.openBufferFiles.map((item) => item.path)).toEqual(["/repo/open.ts"]);
    expect(result.current.recentFilesInResults.map((item) => item.path)).toEqual([
      "/repo/recent-b.ts",
      "/repo/recent-a.ts",
    ]);
    expect(result.current.otherFiles.map((item) => item.name)).toEqual(["alpha.ts", "zeta.ts"]);
  });

  it("caps the listing at the result limit", () => {
    const files = Array.from({ length: 40 }, (_, index) =>
      file(`/repo/file-${String(index).padStart(2, "0")}.ts`),
    );

    const { result } = renderHook(() => useFileSearch(files, ""), {});

    expect(result.current.otherFiles).toHaveLength(20);
    expect(result.current.otherFiles[0].name).toBe("file-00.ts");
  });

  it("ranks fuzzy matches for a query", () => {
    const files = [file("/repo/button.tsx"), file("/repo/notes.md"), file("/repo/big-table.ts")];

    const { result } = renderHook(() => useFileSearch(files, "btn"), {});

    const shown = [
      ...result.current.openBufferFiles,
      ...result.current.recentFilesInResults,
      ...result.current.otherFiles,
    ].map((item) => item.name);
    expect(shown[0]).toBe("button.tsx");
    expect(shown).not.toContain("notes.md");
  });

  it("uses indexed search hits when the native index answered", () => {
    harness.recentFiles = [file("/repo/recent.ts")];
    const hits = [
      { path: "/repo/recent.ts", name: "recent.ts", relative_path: "recent.ts", score: 9 },
      { path: "/repo/other.ts", name: "other.ts", relative_path: "other.ts", score: 5 },
    ];

    const { result } = renderHook(() => useFileSearch([], "re", hits), {});

    expect(result.current.recentFilesInResults.map((item) => item.path)).toEqual([
      "/repo/recent.ts",
    ]);
    expect(result.current.otherFiles.map((item) => item.path)).toEqual(["/repo/other.ts"]);
  });
});

describe("useSearchExcerptTokens", () => {
  const props = { filePath: "/repo/a.ts", content: "const a = 1;", enabled: true };

  it("returns cached tokens without loading", () => {
    harness.snapshot = { key: "cached", tokens: [{ start: 0 }], complete: true };

    const { result } = renderHook(useSearchExcerptTokens, props);

    expect(result.current).toEqual([{ start: 0 }]);
    expect(harness.load).not.toHaveBeenCalled();
  });

  it("returns no tokens while disabled", () => {
    harness.snapshot = { key: "cached", tokens: [{ start: 0 }], complete: true };

    const { result } = renderHook(useSearchExcerptTokens, { ...props, enabled: false });

    expect(result.current).toEqual([]);
  });

  it("tokenizes after a short delay and shows the loaded tokens", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    harness.snapshot = { key: "pending", tokens: [], complete: false };
    harness.load.mockResolvedValue([{ start: 1 }]);

    const { result } = renderHook(useSearchExcerptTokens, props);
    expect(harness.load).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    expect(harness.load).toHaveBeenCalledWith("/repo/a.ts", "const a = 1;");
    expect(result.current).toEqual([{ start: 1 }]);
    vi.unstubAllGlobals();
  });

  it("waits for idle time when the browser offers it", async () => {
    vi.useFakeTimers();
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => idleCallbacks.push(callback));
    harness.snapshot = { key: "pending", tokens: [], complete: false };
    harness.load.mockResolvedValue([{ start: 2 }]);

    const { result } = renderHook(useSearchExcerptTokens, props);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(harness.load).not.toHaveBeenCalled();

    await act(async () => {
      idleCallbacks[0]();
      await Promise.resolve();
    });

    expect(result.current).toEqual([{ start: 2 }]);
    vi.unstubAllGlobals();
  });

  it("retries a failed tokenization once", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    harness.snapshot = { key: "pending", tokens: [], complete: false };
    harness.load.mockRejectedValue(new Error("grammar missing"));

    renderHook(useSearchExcerptTokens, props);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(harness.load).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("cancels pending work when unmounted", async () => {
    vi.useFakeTimers();
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", () => 7);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    harness.snapshot = { key: "pending", tokens: [], complete: false };

    const { unmount } = renderHook(useSearchExcerptTokens, props);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    unmount();

    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    vi.unstubAllGlobals();
  });
});

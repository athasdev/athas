// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useDirectorySize } from "../hooks/use-directory-size";
import { useFileExplorerSync } from "../hooks/use-file-explorer-sync";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const sizes = vi.hoisted(() => ({
  pending: new Map<string, Array<(size: number) => void>>(),
  failures: new Set<string>(),
  started: [] as string[],
}));

vi.mock("@/features/file-system/api/file-system-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/file-system/api/file-system-api")>()),
  getLocalDirectorySize: (path: string) => {
    sizes.started.push(path);
    if (sizes.failures.has(path)) return Promise.reject(new Error("EACCES"));
    return new Promise<number>((resolve) => {
      sizes.pending.set(path, [...(sizes.pending.get(path) ?? []), resolve]);
    });
  },
}));

enableMapSet();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function renderHook<T, P>(useHook: (props: P) => T, initialProps: P) {
  const result = { current: undefined as T };
  let props = initialProps;
  function Harness() {
    result.current = useHook(props);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Harness)));
  return {
    result,
    rerender: async (nextProps: P) => {
      props = nextProps;
      await act(async () => root.render(createElement(Harness)));
    },
  };
}

async function afterPaint() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    await Promise.resolve();
  });
}

function openFile(path: string) {
  let id = "";
  act(() => {
    id = useBufferStore.getState().actions.openContent({
      type: "editor",
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      content: "",
    });
  });
  return id;
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

describe("file explorer sync with the active editor", () => {
  type Props = { activePath?: string; autoRevealActiveFile: boolean };

  async function renderSync(props: Props) {
    const activePaths: string[] = [];
    const revealed: string[] = [];
    const reveals = new Map<string, () => void>();
    const updateActivePath = (path: string) => {
      activePaths.push(path);
    };
    const revealPathInTree = (path: string) => {
      revealed.push(path);
      return new Promise<void>((resolve) => reveals.set(path, resolve));
    };
    const hook = await renderHook(
      (current: Props) => useFileExplorerSync({ ...current, updateActivePath, revealPathInTree }),
      props,
    );
    return { ...hook, activePaths, revealed, reveals };
  }

  it("selects and reveals a newly opened file after the editor paints", async () => {
    const sync = await renderSync({ autoRevealActiveFile: true });

    openFile("/repo/src/main.ts");
    expect(sync.activePaths).toEqual([]);
    await afterPaint();

    expect(sync.activePaths).toEqual(["/repo/src/main.ts"]);
    expect(sync.revealed).toEqual(["/repo/src/main.ts"]);
    expect(sync.result.current.revealRequest).toBeNull();

    await act(async () => sync.reveals.get("/repo/src/main.ts")?.());
    const request = sync.result.current.revealRequest!;
    expect(request.path).toBe("/repo/src/main.ts");

    act(() => sync.result.current.consumeRevealRequest(request.id + 1));
    expect(sync.result.current.revealRequest).toBe(request);
    act(() => sync.result.current.consumeRevealRequest(request.id));
    expect(sync.result.current.revealRequest).toBeNull();
  });

  it("ignores a reveal that finishes after another file became active", async () => {
    const sync = await renderSync({ autoRevealActiveFile: true });

    openFile("/repo/a.ts");
    await afterPaint();
    openFile("/repo/b.ts");
    await afterPaint();
    await act(async () => sync.reveals.get("/repo/a.ts")?.());

    expect(sync.result.current.revealRequest).toBeNull();
    await act(async () => sync.reveals.get("/repo/b.ts")?.());
    expect(sync.result.current.revealRequest?.path).toBe("/repo/b.ts");
  });

  it("only highlights the file when automatic reveal is off", async () => {
    const sync = await renderSync({ autoRevealActiveFile: false });

    openFile("/repo/a.ts");
    await afterPaint();

    expect(sync.activePaths).toEqual(["/repo/a.ts"]);
    expect(sync.revealed).toEqual([]);
  });

  it("clears the highlighted path when no file is active", async () => {
    const sync = await renderSync({ activePath: "/repo/old.ts", autoRevealActiveFile: false });

    expect(sync.activePaths).toEqual([""]);

    const id = openFile("/repo/a.ts");
    await afterPaint();
    await sync.rerender({ activePath: "/repo/a.ts", autoRevealActiveFile: false });
    expect(sync.activePaths).toEqual(["", "/repo/a.ts"]);

    act(() => useBufferStore.getState().actions.closeBufferForce(id));
    await afterPaint();
    expect(sync.activePaths[sync.activePaths.length - 1]).toBe("");
  });
});

describe("directory size", () => {
  beforeEach(() => {
    sizes.pending.clear();
    sizes.failures.clear();
    sizes.started = [];
  });

  it("scans at most two folders at a time and caches results", async () => {
    const first = await renderHook(
      (path: string) => useDirectorySize(path, true),
      "/repo/.cache-a",
    );
    const second = await renderHook(
      (path: string) => useDirectorySize(path, true),
      "/repo/.cache-b",
    );
    const third = await renderHook(
      (path: string) => useDirectorySize(path, true),
      "/repo/.cache-c",
    );

    expect(sizes.started).toEqual(["/repo/.cache-a", "/repo/.cache-b"]);
    expect(first.result.current).toBeNull();

    await act(async () => sizes.pending.get("/repo/.cache-a")?.[0](2048));
    expect(first.result.current).toBe(2048);
    expect(sizes.started).toEqual(["/repo/.cache-a", "/repo/.cache-b", "/repo/.cache-c"]);

    await act(async () => {
      sizes.pending.get("/repo/.cache-b")?.[0](1);
      sizes.pending.get("/repo/.cache-c")?.[0](3);
    });
    expect([second.result.current, third.result.current]).toEqual([1, 3]);

    const again = await renderHook(
      (path: string) => useDirectorySize(path, true),
      "/repo/.cache-a",
    );
    await act(async () => Promise.resolve());
    expect(again.result.current).toBe(2048);
    expect(sizes.started).toHaveLength(3);
  });

  it("shows no size for failed scans or when disabled", async () => {
    sizes.failures.add("/repo/.locked");
    const failed = await renderHook(
      (path: string) => useDirectorySize(path, true),
      "/repo/.locked",
    );
    await act(async () => Promise.resolve());
    expect(failed.result.current).toBeNull();

    const disabled = await renderHook(
      (path: string) => useDirectorySize(path, false),
      "/repo/.disabled",
    );
    expect(disabled.result.current).toBeNull();
    expect(sizes.started).not.toContain("/repo/.disabled");
  });
});

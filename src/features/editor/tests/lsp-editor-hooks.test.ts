// @vitest-environment jsdom
import { act, createElement } from "react";
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

import { extensionRegistry } from "@/extensions/registry/extension-registry";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useLspIntegration } from "../hooks/use-lsp-integration";
import { deferUntilAfterNextPaint } from "../lsp/deferred-lsp-work";
import { useCodeLens } from "../lsp/hooks/use-code-lens";
import { useLspStore } from "../lsp/stores/lsp.store";
import { publishEditorDocumentChange } from "../services/editor-document-events";
import { useBufferStore } from "../stores/buffer.store";

const lsp = vi.hoisted(() => {
  const openDocuments = new Set<string>();
  const servedFiles = new Set<string>();
  return {
    openDocuments,
    servedFiles,
    startForFile: vi.fn(async (_filePath: string, _workspace: string) => true),
    notifyDocumentOpen: vi.fn(async (filePath: string, _content: string) => {
      openDocuments.add(filePath);
    }),
    notifyDocumentClose: vi.fn(async (filePath: string) => {
      openDocuments.delete(filePath);
    }),
    stopForFile: vi.fn(async (_filePath: string) => {}),
    getCodeLens: vi.fn(),
  };
});

vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: {
    getInstance: () => ({
      ...lsp,
      isDocumentOpen: (filePath: string) => lsp.openDocuments.has(filePath),
      getActiveServerEntryForFile: (filePath: string) =>
        lsp.servedFiles.has(filePath) ? { key: "ws:lspy" } : null,
    }),
  },
}));

const FILE = "/ws/src/main.lspy";
let frames: FrameRequestCallback[];
let root: Root;

function flushFrames() {
  while (frames.length > 0) frames.shift()!(0);
}

function renderHook<T>(useHook: (props: { filePath?: string; enabled: boolean }) => T) {
  const result = {} as { current: T };
  let props = { filePath: FILE as string | undefined, enabled: true };
  function Probe() {
    result.current = useHook(props);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    result,
    rerender: (next: Partial<typeof props>) => {
      props = { ...props, ...next };
      act(() => root.render(createElement(Probe)));
    },
  };
}

function editor(path: string, content: string): EditorContent {
  return {
    id: path,
    type: "editor",
    path,
    name: path.split("/").pop()!,
    content,
    savedContent: content,
    isDirty: false,
    isVirtual: false,
    language: "lspy",
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  workspaceRuntimeRegistry.resetForTests();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
  lsp.openDocuments.clear();
  lsp.servedFiles.clear();
  for (const fn of [
    lsp.startForFile,
    lsp.notifyDocumentOpen,
    lsp.notifyDocumentClose,
    lsp.stopForFile,
    lsp.getCodeLens,
  ])
    fn.mockClear();
  extensionRegistry.registerExtension(
    {
      id: "test.lspy",
      name: "lspy",
      displayName: "Lspy",
      languages: [{ id: "lspy", extensions: [".lspy"] }],
      lsp: { server: { default: "/bin/lspy-server" } },
    } as never,
    { path: "/ext/lspy" },
  );
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  extensionRegistry.unregisterExtension("test.lspy");
  workspaceRuntimeRegistry.resetForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("deferUntilAfterNextPaint", () => {
  it("runs after two frames and a task, unless cancelled", () => {
    const run = vi.fn();
    deferUntilAfterNextPaint(run);
    flushFrames();
    expect(run).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    const cancel = deferUntilAfterNextPaint(cancelled);
    flushFrames();
    cancel();
    vi.runAllTimers();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("falls back to a task without animation frames", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const run = vi.fn();
    deferUntilAfterNextPaint(run);
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("useLspIntegration", () => {
  const getValue = vi.fn(() => "print('hi')");

  async function settle() {
    flushFrames();
    await act(async () => {
      vi.runAllTimers();
    });
  }

  it("starts the server after paint in the project folder and opens the document text", async () => {
    useProjectStore.setState({ rootFolderPath: "/ws" });
    renderHook(({ filePath, enabled }) => useLspIntegration({ filePath, enabled, getValue }));
    expect(lsp.startForFile).not.toHaveBeenCalled();

    await settle();

    expect(lsp.startForFile).toHaveBeenCalledWith(FILE, "/ws");
    expect(lsp.notifyDocumentOpen).toHaveBeenCalledWith(FILE, "print('hi')");
  });

  it("uses the file's folder without a project and does not open when the start is refused", async () => {
    lsp.startForFile.mockResolvedValueOnce(false);
    renderHook(({ filePath, enabled }) => useLspIntegration({ filePath, enabled, getValue }));

    await settle();

    expect(lsp.startForFile).toHaveBeenCalledWith(FILE, "/ws/src");
    expect(lsp.notifyDocumentOpen).not.toHaveBeenCalled();
  });

  it("logs a failed start", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    lsp.startForFile.mockRejectedValueOnce(new Error("no server"));
    renderHook(({ filePath, enabled }) => useLspIntegration({ filePath, enabled, getValue }));

    await settle();

    expect(error).toHaveBeenCalledWith("LSP initialization error:", expect.any(Error));
  });

  it("does nothing for unsupported, disabled or missing files", async () => {
    const hook = renderHook(({ filePath, enabled }) =>
      useLspIntegration({ filePath, enabled, getValue }),
    );
    hook.rerender({ filePath: "/ws/readme.unknown" });
    hook.rerender({ filePath: FILE, enabled: false });
    hook.rerender({ filePath: undefined, enabled: true });
    await settle();

    expect(lsp.startForFile).not.toHaveBeenCalled();
  });

  it("closes and stops the document when its last editor goes away", async () => {
    const hook = renderHook(({ filePath, enabled }) =>
      useLspIntegration({ filePath, enabled, getValue }),
    );
    await settle();
    expect(lsp.openDocuments.has(FILE)).toBe(true);

    hook.rerender({ filePath: undefined });

    expect(lsp.notifyDocumentClose).toHaveBeenCalledWith(FILE);
    expect(lsp.stopForFile).toHaveBeenCalledWith(FILE);
  });

  it("keeps the document open while another editor still shows the file", async () => {
    lsp.openDocuments.add(FILE);
    useBufferStore.setState({ buffers: [editor(FILE, "x")] });
    const hook = renderHook(({ filePath, enabled }) =>
      useLspIntegration({ filePath, enabled, getValue }),
    );
    await settle();
    expect(lsp.startForFile).not.toHaveBeenCalled();

    hook.rerender({ filePath: undefined });

    expect(lsp.notifyDocumentClose).not.toHaveBeenCalled();
  });

  it("cancels a pending start when the editor unmounts first", async () => {
    const hook = renderHook(({ filePath, enabled }) =>
      useLspIntegration({ filePath, enabled, getValue }),
    );
    hook.rerender({ enabled: false });
    await settle();

    expect(lsp.startForFile).not.toHaveBeenCalled();
  });
});

describe("useCodeLens", () => {
  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("shows the server's lenses for an open, served document", async () => {
    lsp.openDocuments.add(FILE);
    lsp.servedFiles.add(FILE);
    lsp.getCodeLens.mockResolvedValue([{ line: 2, title: "3 references" }]);

    const { result } = renderHook(({ filePath, enabled }) => useCodeLens(filePath, enabled));
    await flush();

    expect(result.current).toEqual([{ line: 2, title: "3 references" }]);
  });

  it("refreshes lenses after edits to the file pause", async () => {
    lsp.openDocuments.add(FILE);
    lsp.servedFiles.add(FILE);
    lsp.getCodeLens.mockResolvedValue([{ line: 1, title: "1 reference" }]);
    const { result } = renderHook(({ filePath, enabled }) => useCodeLens(filePath, enabled));
    await flush();

    lsp.getCodeLens.mockResolvedValue([{ line: 1, title: "2 references" }]);
    const change = {
      bufferId: FILE,
      sourceId: "test",
      modelSessionId: "m",
      modelVersionId: 2,
      changes: [],
      eol: "\n" as const,
      isEolChange: false,
      isFlush: true,
      isUndoing: false,
      isRedoing: false,
      fullContent: "x",
    };
    publishEditorDocumentChange({ ...change, filePath: "/ws/other.lspy" });
    publishEditorDocumentChange({ ...change, filePath: FILE });
    publishEditorDocumentChange({ ...change, filePath: FILE });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flush();

    expect(lsp.getCodeLens).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual([{ line: 1, title: "2 references" }]);
  });

  it("clears lenses when the document closes or lenses are disabled", async () => {
    lsp.openDocuments.add(FILE);
    lsp.servedFiles.add(FILE);
    lsp.getCodeLens.mockResolvedValue([{ line: 0, title: "run" }]);
    const hook = renderHook(({ filePath, enabled }) => useCodeLens(filePath, enabled));
    await flush();
    expect(hook.result.current).toHaveLength(1);

    lsp.openDocuments.delete(FILE);
    act(() => useLspStore.getState().actions.markDocumentStateChanged());
    await flush();
    expect(hook.result.current).toEqual([]);

    lsp.openDocuments.add(FILE);
    hook.rerender({ enabled: false });
    await flush();
    expect(hook.result.current).toEqual([]);
  });

  it("ignores a response that a newer request superseded", async () => {
    lsp.openDocuments.add(FILE);
    lsp.servedFiles.add(FILE);
    let resolveFirst!: (value: unknown) => void;
    lsp.getCodeLens
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([{ line: 5, title: "fresh" }]);
    const { result } = renderHook(({ filePath, enabled }) => useCodeLens(filePath, enabled));

    act(() => useLspStore.getState().actions.markDocumentStateChanged());
    await flush();
    await act(async () => resolveFirst([{ line: 1, title: "stale" }]));

    expect(result.current).toEqual([{ line: 5, title: "fresh" }]);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { captureWorkspaceEditContext } from "../lsp/workspace-edit";
import { useRename } from "../lsp/use-rename";
import { useBufferStore } from "../stores/buffer.store";
import { useEditorStateStore } from "../stores/state.store";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  rename: vi.fn(),
  toast: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../lsp/lsp-client", () => ({
  LspClient: {
    getInstance: () => ({
      createWorkspaceEditContext: captureWorkspaceEditContext,
      prepareRename: mocks.prepare,
      rename: mocks.rename,
    }),
  },
}));
vi.mock("@/features/layout/contexts/toast-context", () => ({ showToast: mocks.toast }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readText: async () => "alpha", writeText: mocks.write }),
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
let root: Root;
let container: HTMLDivElement;
let rename: ReturnType<typeof useRename>;
const path = "/p/a.ts";
function buffer(id = "a", filePath = path): EditorContent {
  return {
    id,
    type: "editor",
    path: filePath,
    name: "a.ts",
    content: "alpha",
    savedContent: "alpha",
    isDirty: false,
    isVirtual: false,
    isPreview: false,
    isPinned: false,
    isActive: true,
    language: "typescript",
  };
}
function Harness({ filePath = path }: { filePath?: string }) {
  rename = useRename(filePath);
  return <input ref={rename.inputRef} aria-label="Rename" />;
}
async function start() {
  await act(async () => {
    window.dispatchEvent(new Event("editor-rename-symbol"));
  });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const replacement = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
  newText: "beta",
};
const edit = { changes: { "file:///p/a.ts": [replacement] } };
const owner = () => useBufferStore.getStore("owner");
const content = () => (owner().getState().buffers[0] as EditorContent).content;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  owner().setState({ buffers: [buffer()], activeBufferId: "a" });
  useEditorStateStore.setState({ cursorPosition: { line: 0, column: 2, offset: 2 } });
  mocks.prepare.mockReset().mockResolvedValue(null);
  mocks.rename.mockReset().mockResolvedValue(edit);
  mocks.toast.mockClear();
  mocks.write.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("rename request lifecycle", () => {
  it("uses the open draft and preserves a single rename Undo step", async () => {
    await start();
    expect(rename.renameState?.symbol).toBe("alpha");
    await act(async () => rename.executeRename(" beta "));
    expect(mocks.rename).toHaveBeenCalledExactlyOnceWith(path, 0, 2, "beta");
    expect(content()).toBe("beta");
    expect(rename.renameState).toBeNull();
  });
  it("finds the word when the cursor is at its end before whitespace", async () => {
    owner().setState({ buffers: [{ ...buffer(), content: "alpha beta" }] });
    useEditorStateStore.setState({ cursorPosition: { line: 0, column: 5, offset: 5 } });
    await start();
    expect(rename.renameState?.symbol).toBe("alpha");
  });
  it.each(["café", "变量"])(
    "preserves Unicode identifiers in the rename fallback: %s",
    async (symbol) => {
      owner().setState({ buffers: [{ ...buffer(), content: symbol }] });
      useEditorStateStore.setState({ cursorPosition: { line: 0, column: 1, offset: 1 } });
      await start();
      expect(rename.renameState?.symbol).toBe(symbol);
    },
  );
  it("does not show a canceled delayed prepare result", async () => {
    const pending = deferred<null>();
    mocks.prepare.mockReturnValueOnce(pending.promise);
    await start();
    await act(async () => rename.cancelRename());
    await act(async () => pending.resolve(null));
    expect(rename.renameState).toBeNull();
    expect(mocks.rename).not.toHaveBeenCalled();
  });
  it("drops a delayed prepare result after typing and Undo to the same text", async () => {
    const pending = deferred<null>();
    mocks.prepare.mockReturnValueOnce(pending.promise);
    await start();
    await act(async () => {
      owner().getState().actions.updateBufferContent("a", "newer", true);
      owner().getState().actions.updateBufferContent("a", "alpha", true);
      pending.resolve(null);
    });
    expect(rename.renameState).toBeNull();
  });
  it("ignores a delayed rename after switching tabs", async () => {
    const pending = deferred<typeof edit>();
    mocks.rename.mockReturnValueOnce(pending.promise);
    await start();
    let running: Promise<void> = Promise.resolve();
    await act(async () => {
      running = rename.executeRename("beta");
    });
    await act(async () =>
      owner().setState({ buffers: [buffer(), buffer("b", "/p/b.ts")], activeBufferId: "b" }),
    );
    await act(async () => {
      pending.resolve(edit);
      await running;
    });
    expect(content()).toBe("alpha");
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("ignores a delayed rename after a workspace switch", async () => {
    const pending = deferred<typeof edit>();
    mocks.rename.mockReturnValueOnce(pending.promise);
    await start();
    let running: Promise<void> = Promise.resolve();
    await act(async () => {
      running = rename.executeRename("beta");
    });
    await act(async () =>
      workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" }),
    );
    await act(async () => {
      pending.resolve(edit);
      await running;
    });
    expect(content()).toBe("alpha");
  });
  it("prevents duplicate submissions before a render", async () => {
    const pending = deferred<typeof edit>();
    mocks.rename.mockReturnValueOnce(pending.promise);
    await start();
    let running: Promise<void> = Promise.resolve();
    await act(async () => {
      running = rename.executeRename("beta");
      void rename.executeRename("gamma");
    });
    expect(mocks.rename).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(edit);
      await running;
    });
    expect(content()).toBe("beta");
  });
  it("applies a multi-file rename after changing the requesting document first", async () => {
    mocks.rename.mockResolvedValue({
      changes: { ...edit.changes, "file:///p/b.ts": [replacement] },
    });
    await start();
    await act(async () => rename.executeRename("beta"));
    expect(content()).toBe("beta");
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith("/p/b.ts", "beta", "alpha");
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("shows an unsupported edit failure without executing disk writes", async () => {
    mocks.rename.mockResolvedValue({
      documentChanges: [{ kind: "delete", uri: "file:///p/a.ts" }],
    });
    await start();
    await act(async () => rename.executeRename("beta"));
    expect(content()).toBe("alpha");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });
});

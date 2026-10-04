// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { PendingBufferCloseDialog } from "../components/pending-buffer-close-dialog";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  props: [] as Array<{ onDiscard: () => void; onSave: () => Promise<unknown> }>,
}));
vi.mock("@/features/panes/services/pane-content-save-service", () => ({
  savePendingPaneClose: mocks.save,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("@/features/window/components/unsaved-changes-dialog", () => ({
  default: (props: {
    fileName: string;
    onSave: () => Promise<unknown>;
    onDiscard: () => void;
    onCancel: () => void;
  }) => {
    mocks.props.push(props);
    return (
      <div role="alertdialog">
        {props.fileName}
        <button onClick={props.onDiscard}>Discard</button>
      </div>
    );
  },
}));
function editor(id: string): EditorContent {
  return {
    id,
    type: "editor",
    path: `/${id}.ts`,
    name: `${id}.ts`,
    content: "draft",
    savedContent: "disk",
    isDirty: true,
    isVirtual: false,
    isPinned: false,
    isPreview: false,
    isActive: false,
    language: "typescript",
    tokens: [],
  };
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  useBufferStore.setState({
    buffers: [editor("a"), editor("b")],
    activeBufferId: "b",
    pendingClose: { bufferId: "a", type: "all" },
  });
  mocks.props.length = 0;
  mocks.save.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<PendingBufferCloseDialog />));
}

describe("pending tab close dialog owner", () => {
  it("names the pending draft from the full store rather than the active pane", async () => {
    await render();
    expect(container.textContent).toContain("a.ts");
    expect(container.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  });
  it("advances one discard decision at a time in the same dialog host", async () => {
    await render();
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("b.ts");
    expect(container.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({ id: "b", isDirty: true });
  });
  it("ignores callbacks retained after the workspace switches", async () => {
    const owner = useBufferStore.getStore("owner");
    await render();
    const original = mocks.props[mocks.props.length - 1]!;
    await act(async () =>
      workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" }),
    );
    await act(async () => original.onDiscard());
    await expect(original.onSave()).resolves.toBe(false);
    expect(owner.getState().buffers).toHaveLength(2);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("ignores a decision replaced by a newer request", async () => {
    await render();
    const original = mocks.props[mocks.props.length - 1]!;
    await act(async () =>
      useBufferStore.getState().actions.setPendingClose({ bufferId: "b", type: "single" }),
    );
    await act(async () => original.onDiscard());
    expect(useBufferStore.getState().buffers).toHaveLength(2);
    expect(useBufferStore.getState().pendingClose?.bufferId).toBe("b");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content";
import { useBufferStore } from "../stores/buffer-store";
import { revertActiveFile } from "@/features/keymaps/commands/file-command-actions";

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
}));

vi.mock("@/features/file-system/controllers/file-operations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/file-system/controllers/file-operations")>();
  return {
    ...original,
    readFileContent: mocks.readFileContent,
  };
});

function makeDirtyEditorBuffer(): EditorContent {
  return {
    id: "revert-buffer",
    type: "editor",
    path: "/workspace/revert.ts",
    name: "revert.ts",
    content: "draft",
    savedContent: "saved",
    isDirty: true,
    isVirtual: false,
    isPinned: false,
    isPreview: false,
    isActive: true,
    language: "typescript",
    tokens: [],
  };
}

describe("editor revert file command", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.readFileContent.mockResolvedValue("disk");

    useBufferStore.setState({
      activeBufferId: "revert-buffer",
      buffers: [makeDirtyEditorBuffer()],
      pendingClose: null,
      closedBuffersHistory: [],
    });
  });

  afterEach(() => {
    useBufferStore.setState({
      activeBufferId: null,
      buffers: [],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.clearAllMocks();
  });

  it("reloads the active local editor buffer from disk and clears dirty state", async () => {
    await revertActiveFile();

    expect(mocks.readFileContent).toHaveBeenCalledWith("/workspace/revert.ts");
    const buffer = useBufferStore.getState().buffers[0];
    expect(buffer).toMatchObject({
      content: "disk",
      isDirty: false,
      savedContent: "disk",
    });
  });
});

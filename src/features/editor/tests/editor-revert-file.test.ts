import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { revertActiveFile } from "@/features/keymaps/commands/file-command-actions";
import { useBufferStore } from "../stores/buffer.store";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
}));

vi.mock("@/features/file-system/api/file-operations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/file-system/api/file-operations")>();
  return {
    ...original,
    readFileContent: mocks.readFileContent,
  };
});

const createMockStorage = () => {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
};

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
    language: "typescript",
  };
}

describe("editor revert file command", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn().mockResolvedValue([]),
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    mocks.readFileContent.mockResolvedValue("disk");

    useBufferStore.setState({
      buffers: [makeDirtyEditorBuffer()],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    seedActiveBuffer("revert-buffer");
  });

  afterEach(() => {
    useBufferStore.setState({
      buffers: [],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
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

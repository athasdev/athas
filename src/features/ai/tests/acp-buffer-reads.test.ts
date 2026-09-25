import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  answerAcpBufferRead,
  getOpenBufferContent,
  initializeAcpBufferReads,
} from "@/features/ai/services/acp-buffer-reads";

const mocks = vi.hoisted(() => ({
  activeBuffers: [] as unknown[],
  backgroundBuffers: [] as unknown[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({ buffers: mocks.activeBuffers }),
  },
}));

vi.mock("@/features/workspace/runtime/workspace-runtime-registry", () => ({
  workspaceRuntimeRegistry: {
    getExistingStores: () => [{ getState: () => ({ buffers: mocks.backgroundBuffers }) }],
  },
}));

function editor(path: string, content: string, extra: Record<string, unknown> = {}) {
  return { id: path, path, type: "editor", isVirtual: false, content, isDirty: true, ...extra };
}

describe("ACP buffer reads", () => {
  beforeEach(() => {
    mocks.activeBuffers = [];
    mocks.backgroundBuffers = [];
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
  });

  it("answers with the open buffer's unsaved text", async () => {
    mocks.activeBuffers = [editor("/repo/a.ts", "unsaved edit\n")];

    await answerAcpBufferRead({ requestId: "r1", path: "/repo/a.ts" });

    expect(invoke).toHaveBeenCalledWith("respond_acp_buffer_read", {
      requestId: "r1",
      content: "unsaved edit\n",
    });
  });

  it("answers null when the file is not open, so the disk is read", async () => {
    mocks.activeBuffers = [editor("/repo/a.ts", "a")];

    await answerAcpBufferRead({ requestId: "r2", path: "/repo/b.ts" });

    expect(invoke).toHaveBeenCalledWith("respond_acp_buffer_read", {
      requestId: "r2",
      content: null,
    });
  });

  it("finds files open in other workspaces and skips non-editor views", () => {
    mocks.activeBuffers = [
      { id: "diff", path: "/repo/c.ts", type: "diff", content: "diff text" },
      editor("/repo/c.ts", "virtual", { isVirtual: true }),
    ];
    mocks.backgroundBuffers = [editor("/other/d.ts", "background")];

    expect(getOpenBufferContent("/other/d.ts")).toBe("background");
    expect(getOpenBufferContent("/repo/c.ts")).toBeNull();
  });

  it("answers every read request the client emits", async () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (event, callback) => {
      expect(event).toBe("acp-buffer-read");
      handler = callback as typeof handler;
      return () => undefined;
    });
    vi.mocked(invoke).mockResolvedValue(undefined);
    mocks.activeBuffers = [editor("/repo/a.ts", "live")];

    await initializeAcpBufferReads();
    handler?.({ payload: { requestId: "r3", path: "/repo/a.ts" } });

    expect(invoke).toHaveBeenCalledWith("respond_acp_buffer_read", {
      requestId: "r3",
      content: "live",
    });
  });
});

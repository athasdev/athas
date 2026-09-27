// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  currentTurnMessageId,
  listCheckpoints,
  recordCheckpointAgentWrite,
  restoreCheckpoint,
} from "@/features/ai/services/agent-checkpoints-service";
import { useAgentCheckpointsStore } from "@/features/ai/stores/agent-checkpoints.store";
import { getAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";

const mocks = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  saved: new Map<string, string | null>(),
  buffers: [] as Array<Record<string, unknown>>,
  chats: [] as Array<{ id: string; messages: Array<Record<string, unknown>> }>,
  agentRuns: {} as Record<string, { assistantMessageId: string }>,
  updateBufferContent: vi.fn(),
  closeBufferForce: vi.fn(),
  showToast: vi.fn(),
  showConfirmDialog: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "load_chat_checkpoints") return mocks.saved.get(args.chatId as string) ?? null;
    if (command === "save_chat_checkpoints") {
      mocks.saved.set(args.chatId as string, args.data as string | null);
    }
    return null;
  },
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: { getState: () => ({ chats: mocks.chats, agentRuns: mocks.agentRuns }) },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: mocks.buffers,
      actions: {
        updateBufferContent: mocks.updateBufferContent,
        closeBufferForce: mocks.closeBufferForce,
      },
    }),
  },
}));
vi.mock("@/features/editor/utils/buffer-index", () => ({
  getBufferByPath: (buffers: Array<{ path: string }>, path: string) =>
    buffers.find((buffer) => buffer.path === path) ?? null,
}));
vi.mock("@/features/file-system/controllers/file-operations", () => ({
  readFileContent: async (path: string) => {
    const content = mocks.disk.get(path);
    if (content === undefined) throw new Error("missing");
    return content;
  },
  deleteFileOrDirectory: async (path: string) => {
    mocks.disk.delete(path);
  },
}));
vi.mock("@/features/file-system/controllers/platform", () => ({
  writeFile: async (path: string, content: string) => {
    mocks.disk.set(path, content);
  },
}));
vi.mock("@/features/file-system/stores/file-watcher.store", () => ({
  useFileWatcherStore: { getState: () => ({ actions: { markPendingSave: vi.fn() } }) },
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: vi.fn() }));
vi.mock("@/features/layout/contexts/toast-context", () => ({ showToast: mocks.showToast }));
vi.mock("@/ui/dialog", () => ({ showConfirmDialog: mocks.showConfirmDialog }));

const CHAT = "chat-1";

function message(id: string, role: "user" | "assistant", at: number) {
  return { id, role, content: "", timestamp: new Date(at) };
}

/** The agent writes `content` over what the disk holds during the turn `messageId` started. */
async function agentWrites(messageId: string, path: string, content: string) {
  const previousContent = mocks.disk.get(path) ?? null;
  mocks.disk.set(path, content);
  await recordCheckpointAgentWrite(CHAT, messageId, { path, previousContent, content });
}

describe("agent checkpoints service", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mocks.disk.clear();
    mocks.saved.clear();
    mocks.buffers.length = 0;
    mocks.chats = [
      {
        id: CHAT,
        messages: [
          message("u1", "user", 1),
          message("a1", "assistant", 2),
          message("u2", "user", 3),
          message("a2", "assistant", 4),
        ],
      },
    ];
    mocks.agentRuns = {};
    for (const mock of [
      mocks.updateBufferContent,
      mocks.closeBufferForce,
      mocks.showToast,
      mocks.showConfirmDialog,
    ]) {
      mock.mockReset();
    }
    useAgentCheckpointsStore.setState({ byChat: {} });
    useAgentEditsStore.setState({ byChat: {}, reviewChatId: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the turn by the user message before the running reply", () => {
    expect(currentTurnMessageId(CHAT)).toBe("u2");
    mocks.agentRuns[CHAT] = { assistantMessageId: "a1" };
    expect(currentTurnMessageId(CHAT)).toBe("u1");
    expect(currentTurnMessageId("other")).toBeNull();
  });

  it("restores the files a turn changed, deleting the ones it created", async () => {
    mocks.disk.set("/a", "a0");
    await agentWrites("u1", "/a", "a1");
    await agentWrites("u2", "/a", "a2");
    await agentWrites("u2", "/new", "n1");

    expect((await listCheckpoints(CHAT)).map((checkpoint) => checkpoint.messageId)).toEqual([
      "u1",
      "u2",
    ]);

    const result = await restoreCheckpoint(CHAT, "u2");
    expect(result).toEqual({
      status: "restored",
      restoredPaths: ["/a", "/new"],
      failedPaths: [],
    });
    expect(mocks.disk.get("/a")).toBe("a1");
    expect(mocks.disk.has("/new")).toBe(false);
    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect((await listCheckpoints(CHAT)).map((checkpoint) => checkpoint.messageId)).toEqual(["u1"]);
  });

  it("asks before discarding changes made after the agent's and unsaved edits", async () => {
    mocks.disk.set("/a", "a0");
    await agentWrites("u1", "/a", "a1");
    mocks.disk.set("/a", "a1 edited by the user");

    mocks.showConfirmDialog.mockResolvedValueOnce(false);
    expect(await restoreCheckpoint(CHAT, "u1")).toEqual({ status: "cancelled" });
    expect(mocks.disk.get("/a")).toBe("a1 edited by the user");

    mocks.disk.set("/a", "a1");
    mocks.buffers.push({ id: "buf", path: "/a", type: "editor", isDirty: true, content: "draft" });
    mocks.showConfirmDialog.mockResolvedValueOnce(true);
    expect((await restoreCheckpoint(CHAT, "u1")).status).toBe("restored");
    expect(mocks.showConfirmDialog).toHaveBeenCalledTimes(2);
    expect(mocks.disk.get("/a")).toBe("a0");
    expect(mocks.updateBufferContent).toHaveBeenCalledWith("buf", "a0", false);
  });

  it("drops review of the undone turns and keeps review of earlier ones", async () => {
    mocks.disk.set("/a", "x\ny\nz");
    await agentWrites("u1", "/a", "X\ny\nz");
    await agentWrites("u2", "/a", "X\ny\nZ");
    useAgentEditsStore.getState().actions.setEntry(CHAT, "/a", {
      path: "/a",
      baseline: "x\ny\nz",
      current: "X\ny\nZ",
      created: false,
      revision: 2,
      turnId: "u1",
    });

    await restoreCheckpoint(CHAT, "u2");
    expect(getAgentEditEntries(CHAT)["/a"]).toMatchObject({
      baseline: "x\ny\nz",
      current: "X\ny\nz",
    });

    await restoreCheckpoint(CHAT, "u1");
    expect(getAgentEditEntries(CHAT)["/a"]).toBeUndefined();
  });

  it("keeps checkpoints across reloads", async () => {
    mocks.disk.set("/a", "a0");
    await agentWrites("u1", "/a", "a1");
    await vi.runAllTimersAsync();
    expect(mocks.saved.get(CHAT)).toContain("a0");

    useAgentCheckpointsStore.setState({ byChat: {} });
    expect(await restoreCheckpoint(CHAT, "u1")).toMatchObject({ status: "restored" });
    expect(mocks.disk.get("/a")).toBe("a0");
    expect(await restoreCheckpoint(CHAT, "u1")).toEqual({ status: "nothing-to-restore" });
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clearChatCheckpoints,
  currentTurnMessageId,
  ensureCheckpointsLoaded,
  forgetChatCheckpoints,
  listCheckpoints,
  recordCheckpointAgentWrite,
  restoreCheckpoint,
} from "@/features/ai/services/agent-checkpoints-service";
import { useAgentCheckpointsStore } from "@/features/ai/stores/agent-checkpoints.store";
import { getAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";

const mocks = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  load: vi.fn(),
  saved: new Map<string, string | null>(),
  buffers: [] as Array<Record<string, unknown>>,
  chats: [] as Array<{ id: string; messages: Array<Record<string, unknown>> }>,
  agentRuns: {} as Record<string, { assistantMessageId: string }>,
  writeFile: vi.fn(),
  deleteFileOrDirectory: vi.fn(),
  updateBufferContent: vi.fn(),
  closeBufferForce: vi.fn(),
  showToast: vi.fn(),
  showConfirmDialog: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "load_chat_checkpoints") return mocks.load(args.chatId);
    if (command === "save_chat_checkpoints") {
      mocks.saved.set(args.chatId as string, args.data as string | null);
    }
    return null;
  },
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => ({
      chats: mocks.chats,
      messagesByChat: Object.fromEntries(mocks.chats.map((chat) => [chat.id, chat.messages])),
      agentRuns: mocks.agentRuns,
    }),
  },
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
vi.mock("@/features/editor/stores/buffer-index", () => ({
  getBufferByPath: (buffers: Array<{ path: string }>, path: string) =>
    buffers.find((buffer) => buffer.path === path) ?? null,
}));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({
    readText: async (path: string) => {
      const content = mocks.disk.get(path);
      if (content === undefined) throw new Error("missing");
      return content;
    },
    writeText: mocks.writeFile,
    deleteText: mocks.deleteFileOrDirectory,
  }),
}));

vi.mock("@/features/file-system/stores/file-watcher.store", () => ({
  useFileWatcherStore: {
    getState: () => ({ actions: { markPendingSave: vi.fn(), clearPendingSave: vi.fn() } }),
  },
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: vi.fn() }));
vi.mock("@/utils/toast", () => ({ showToast: mocks.showToast }));
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
    mocks.load
      .mockReset()
      .mockImplementation(async (chatId: string) => mocks.saved.get(chatId) ?? null);
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
    mocks.writeFile.mockReset().mockImplementation(async (path: string, content: string) => {
      mocks.disk.set(path, content);
    });
    mocks.deleteFileOrDirectory.mockReset().mockImplementation(async (path: string) => {
      mocks.disk.delete(path);
    });
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

  it("keeps failed file snapshots across turns and retries only those files", async () => {
    mocks.disk.set("/a", "a0");
    mocks.disk.set("/b", "b0");
    await agentWrites("u1", "/a", "a1");
    await agentWrites("u1", "/b", "b1");
    await agentWrites("u2", "/b", "b2");
    mocks.writeFile
      .mockImplementationOnce(async (path: string, content: string) => {
        mocks.disk.set(path, content);
      })
      .mockRejectedValueOnce(new Error("Disk full"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await restoreCheckpoint(CHAT, "u1")).toEqual({
        status: "restored",
        restoredPaths: ["/a"],
        failedPaths: ["/b"],
      });
    } finally {
      log.mockRestore();
    }
    expect(
      (await listCheckpoints(CHAT)).map((checkpoint) => checkpoint.files.map((file) => file.path)),
    ).toEqual([["/b"], ["/b"]]);
    await vi.runAllTimersAsync();
    useAgentCheckpointsStore.setState({ byChat: {} });
    expect(await restoreCheckpoint(CHAT, "u1")).toEqual({
      status: "restored",
      restoredPaths: ["/b"],
      failedPaths: [],
    });
    expect(mocks.disk.get("/a")).toBe("a0");
    expect(mocks.disk.get("/b")).toBe("b0");
    expect(await listCheckpoints(CHAT)).toEqual([]);
  });

  it("keeps an editor open and its snapshot when checkpoint deletion fails", async () => {
    await agentWrites("u1", "/new", "created");
    mocks.buffers.push({
      id: "new-buffer",
      type: "editor",
      path: "/new",
      isDirty: false,
      content: "created",
    });
    mocks.deleteFileOrDirectory.mockRejectedValueOnce(new Error("Permission denied"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await restoreCheckpoint(CHAT, "u1")).toMatchObject({ failedPaths: ["/new"] });
    } finally {
      log.mockRestore();
    }
    expect(mocks.closeBufferForce).not.toHaveBeenCalled();
    expect((await listCheckpoints(CHAT))[0].files[0].path).toBe("/new");
    await restoreCheckpoint(CHAT, "u1");
    expect(mocks.closeBufferForce).toHaveBeenCalledWith("new-buffer");
    expect(mocks.disk.has("/new")).toBe(false);
  });

  it("keeps edits typed while a checkpoint write is in flight", async () => {
    mocks.disk.set("/a", "before");
    await agentWrites("u1", "/a", "after");
    mocks.buffers.push({
      id: "buffer",
      type: "editor",
      path: "/a",
      isDirty: false,
      content: "after",
    });
    mocks.writeFile.mockImplementationOnce(
      async (path: string, content: string, expected: string) => {
        expect(expected).toBe("after");
        mocks.disk.set(path, content);
        mocks.buffers = [
          { id: "buffer", type: "editor", path: "/a", isDirty: true, content: "typed meanwhile" },
        ];
      },
    );
    await restoreCheckpoint(CHAT, "u1");
    expect(mocks.disk.get("/a")).toBe("before");
    expect(mocks.updateBufferContent).not.toHaveBeenCalled();
    expect(mocks.buffers[0].content).toBe("typed meanwhile");
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

  it("clears a chat's checkpoints in memory and in the database", async () => {
    mocks.disk.set("/a", "a0");
    await agentWrites("u1", "/a", "a1");
    await vi.runAllTimersAsync();
    expect(mocks.saved.get(CHAT)).toEqual(expect.any(String));
    await clearChatCheckpoints(CHAT);
    await vi.runAllTimersAsync();
    expect(mocks.saved.get(CHAT)).toBeNull();
    expect(await listCheckpoints(CHAT)).toEqual([]);
  });

  it("does not restore a forgotten chat from an in-flight load or queued write", async () => {
    let finish: (data: string | null) => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
          markStarted();
        }),
    );
    const pending = recordCheckpointAgentWrite(CHAT, "u1", {
      path: "/a",
      previousContent: "before",
      content: "after",
    });
    await started;
    expect(mocks.load).toHaveBeenCalledOnce();
    forgetChatCheckpoints(CHAT);
    mocks.chats = [];
    finish(null);
    await pending;
    await vi.runAllTimersAsync();
    expect(useAgentCheckpointsStore.getState().byChat[CHAT]).toBeUndefined();
    expect(mocks.saved.has(CHAT)).toBe(false);
  });

  it("keeps a cleared chat empty when a queued write finishes loading", async () => {
    let finish: (data: string | null) => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
          markStarted();
        }),
    );
    const pending = recordCheckpointAgentWrite(CHAT, "u1", {
      path: "/a",
      previousContent: "before",
      content: "after",
    });
    await started;
    const cleared = clearChatCheckpoints(CHAT);
    finish(null);
    await Promise.all([pending, cleared]);
    await vi.runAllTimersAsync();
    expect(await listCheckpoints(CHAT)).toEqual([]);
    expect(mocks.saved.get(CHAT)).toBeNull();
  });

  it("does not let an old load replace or detach a reopened chat's load", async () => {
    let finishOld: (data: string | null) => void = () => {};
    let finishNew: (data: string | null) => void = () => {};
    mocks.load
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            finishNew = resolve;
          }),
      );
    const oldLoad = ensureCheckpointsLoaded(CHAT);
    forgetChatCheckpoints(CHAT);
    const newLoad = ensureCheckpointsLoaded(CHAT);
    finishOld(null);
    await oldLoad;
    expect(ensureCheckpointsLoaded(CHAT)).toBe(newLoad);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    finishNew(
      JSON.stringify({
        checkpoints: [
          {
            messageId: "u2",
            createdAt: 3,
            files: { "/new": { path: "/new", before: null, after: "new" } },
          },
        ],
        truncatedAt: null,
      }),
    );
    await newLoad;
    expect((await listCheckpoints(CHAT)).map((checkpoint) => checkpoint.messageId)).toEqual(["u2"]);
  });

  it("cancels a restore if the chat is forgotten while confirmation is open", async () => {
    mocks.disk.set("/a", "before");
    await agentWrites("u1", "/a", "after");
    mocks.disk.set("/a", "user change");
    mocks.showConfirmDialog.mockImplementationOnce(async () => {
      forgetChatCheckpoints(CHAT);
      return true;
    });
    expect(await restoreCheckpoint(CHAT, "u1")).toEqual({ status: "cancelled" });
    expect(mocks.disk.get("/a")).toBe("user change");
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("does not save a deleted chat's checkpoints back", async () => {
    mocks.disk.set("/a", "a0");
    await agentWrites("u1", "/a", "a1");
    forgetChatCheckpoints(CHAT);
    await vi.runAllTimersAsync();
    expect(mocks.saved.has(CHAT)).toBe(false);
    expect(useAgentCheckpointsStore.getState().byChat[CHAT]).toBeUndefined();
  });
});

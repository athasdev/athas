// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { computeAgentHunks } from "@/features/ai/lib/agent-edit-hunks";
import {
  keepAgentHunk,
  keepAllAgentEdits,
  recordAgentFileWrite,
  rejectAgentHunk,
  rejectAllAgentEdits,
  scheduleAgentEditsDiskCheck,
} from "@/features/ai/services/agent-edits-service";
import { getAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";

const mocks = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  buffers: [] as Array<Record<string, unknown>>,
  updateBufferContent: vi.fn(),
  closeBufferForce: vi.fn(),
  markPendingSave: vi.fn(),
  showToast: vi.fn(),
  showConfirmDialog: vi.fn(),
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
  useFileWatcherStore: {
    getState: () => ({ actions: { markPendingSave: mocks.markPendingSave } }),
  },
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: vi.fn() }));
vi.mock("@/features/layout/contexts/toast-context", () => ({ showToast: mocks.showToast }));
vi.mock("@/ui/dialog", () => ({ showConfirmDialog: mocks.showConfirmDialog }));

const CHAT = "chat-1";
const PATH = "/repo/a.ts";
const lines = (...values: string[]) => values.join("\n");

/** An agent write as the Rust client reports it, with the disk already holding the new text. */
function agentWrites(previousContent: string | null, content: string, path = PATH, chat = CHAT) {
  mocks.disk.set(path, content);
  recordAgentFileWrite(chat, { path, previousContent, content });
}

function entry(path = PATH, chat = CHAT) {
  return getAgentEditEntries(chat)[path];
}

function hunks(path = PATH) {
  const current = entry(path);
  return current ? computeAgentHunks(current.baseline, current.current) : [];
}

describe("agent edits service", () => {
  beforeEach(() => {
    mocks.disk.clear();
    mocks.buffers = [];
    for (const mock of [
      mocks.updateBufferContent,
      mocks.closeBufferForce,
      mocks.markPendingSave,
      mocks.showToast,
      mocks.showConfirmDialog,
    ]) {
      mock.mockReset();
    }
    useAgentEditsStore.setState({ byChat: {}, reviewChatId: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a hunk without touching the file", async () => {
    agentWrites(lines("a", "b", "c", "d"), lines("A", "b", "c", "D"));
    await keepAgentHunk(CHAT, PATH, hunks()[0]);

    expect(mocks.disk.get(PATH)).toBe(lines("A", "b", "c", "D"));
    expect(hunks()).toEqual([
      { baseStart: 3, baseLines: ["d"], currentStart: 3, currentLines: ["D"] },
    ]);
  });

  it("rejects a hunk on disk and in a clean editor", async () => {
    mocks.buffers = [{ id: "b1", type: "editor", path: PATH, isDirty: false, content: "" }];
    agentWrites(lines("a", "b", "c", "d"), lines("A", "b", "c", "D"));
    await rejectAgentHunk(CHAT, PATH, hunks()[1]);

    expect(mocks.disk.get(PATH)).toBe(lines("A", "b", "c", "d"));
    expect(mocks.markPendingSave).toHaveBeenCalledWith(PATH);
    expect(mocks.updateBufferContent).toHaveBeenCalledWith("b1", lines("A", "b", "c", "d"), false);
    expect(hunks()).toHaveLength(1);
  });

  it("applies a reject on top of unsaved edits that are clear of it", async () => {
    agentWrites(lines("a", "b", "c", "d", "e"), lines("A", "b", "c", "d", "e"));
    mocks.buffers = [
      {
        id: "b1",
        type: "editor",
        path: PATH,
        isDirty: true,
        content: lines("A", "b", "c", "d", "e", "typed"),
      },
    ];
    await rejectAgentHunk(CHAT, PATH, hunks()[0]);

    expect(mocks.disk.get(PATH)).toBe(lines("a", "b", "c", "d", "e"));
    expect(mocks.updateBufferContent).toHaveBeenLastCalledWith(
      "b1",
      lines("a", "b", "c", "d", "e", "typed"),
      true,
    );
    expect(entry()).toBeUndefined();
  });

  it("refuses a reject that overlaps unsaved edits", async () => {
    agentWrites(lines("a", "b"), lines("A", "b"));
    mocks.buffers = [
      { id: "b1", type: "editor", path: PATH, isDirty: true, content: lines("AA", "b") },
    ];
    await rejectAgentHunk(CHAT, PATH, hunks()[0]);

    expect(mocks.disk.get(PATH)).toBe(lines("A", "b"));
    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
    expect(hunks()).toHaveLength(1);
  });

  it("accumulates writes and resolves the chat with keep all and reject all", async () => {
    agentWrites(lines("a", "b"), lines("A", "b"));
    agentWrites(lines("A", "b"), lines("A", "B"));
    agentWrites("x", "y", "/repo/b.ts");
    expect(hunks()).toHaveLength(1);
    expect(entry()?.baseline).toBe(lines("a", "b"));

    await keepAllAgentEdits(CHAT);
    expect(getAgentEditEntries(CHAT)).toEqual({});

    agentWrites(lines("A", "B"), lines("A", "B", "c"));
    await rejectAllAgentEdits(CHAT);
    expect(mocks.disk.get(PATH)).toBe(lines("A", "B"));
    expect(getAgentEditEntries(CHAT)).toEqual({});
  });

  it("deletes a file the agent created when all of it is rejected", async () => {
    agentWrites(null, "new file");
    await rejectAllAgentEdits(CHAT);

    expect(mocks.disk.has(PATH)).toBe(false);
    expect(entry()).toBeUndefined();
  });

  it("deletes a created file with unsaved edits only after the user confirms", async () => {
    agentWrites(null, "new file");
    mocks.buffers = [{ id: "buf", type: "editor", path: PATH, isDirty: true, content: "mine" }];

    mocks.showConfirmDialog.mockResolvedValueOnce(false);
    await rejectAllAgentEdits(CHAT);
    expect(mocks.disk.get(PATH)).toBe("new file");
    expect(entry()).toBeDefined();
    expect(mocks.closeBufferForce).not.toHaveBeenCalled();

    mocks.showConfirmDialog.mockResolvedValueOnce(true);
    await rejectAllAgentEdits(CHAT);
    expect(mocks.disk.has(PATH)).toBe(false);
    expect(entry()).toBeUndefined();
    expect(mocks.closeBufferForce).toHaveBeenCalledWith("buf");
    expect(mocks.updateBufferContent).not.toHaveBeenCalled();
  });

  it("reviews each chat's own changes when two chats' agents write the same file", async () => {
    const OTHER = "chat-2";
    agentWrites(lines("a", "b", "c"), lines("A", "b", "c"));
    agentWrites(lines("A", "b", "c"), lines("A", "b", "C"), PATH, OTHER);

    // The other chat's change moved into this chat's baseline at once.
    expect(entry()?.baseline).toBe(lines("a", "b", "C"));
    expect(entry()?.current).toBe(lines("A", "b", "C"));
    expect(entry(PATH, OTHER)?.baseline).toBe(lines("A", "b", "c"));

    // Rejecting in the other chat leaves this chat's hunk to review against the new text.
    await rejectAllAgentEdits(OTHER);
    expect(mocks.disk.get(PATH)).toBe(lines("A", "b", "c"));
    expect(entry()?.baseline).toBe(lines("a", "b", "c"));
    expect(hunks()).toEqual([
      { baseStart: 0, baseLines: ["a"], currentStart: 0, currentLines: ["A"] },
    ]);
  });

  it("stops tracking where another chat's agent overwrote this chat's lines", () => {
    agentWrites(lines("a", "b"), lines("A", "b"));
    agentWrites(lines("A", "b"), lines("X", "b"), PATH, "chat-2");

    expect(entry()).toBeUndefined();
    expect(entry(PATH, "chat-2")?.baseline).toBe(lines("A", "b"));
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Another chat's agent changed the lines this chat's agent had edited.",
      }),
    );
  });

  it("drops a file changed on disk where the agent edited it", async () => {
    vi.useFakeTimers();
    agentWrites(lines("a", "b"), lines("A", "b"));
    mocks.disk.set(PATH, lines("user", "b"));
    scheduleAgentEditsDiskCheck(PATH);
    await vi.runAllTimersAsync();

    expect(entry()).toBeUndefined();
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Stopped tracking agent changes to a.ts" }),
    );
  });

  it("keeps tracking through a disk change away from the agent's lines", async () => {
    vi.useFakeTimers();
    agentWrites(lines("a", "b", "c"), lines("A", "b", "c"));
    mocks.disk.set(PATH, lines("A", "b", "c", "saved"));
    window.dispatchEvent(new CustomEvent("file-external-change", { detail: { path: PATH } }));
    await vi.runAllTimersAsync();

    expect(entry()?.baseline).toBe(lines("a", "b", "c", "saved"));
    expect(hunks()).toHaveLength(1);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("drops a file that was deleted", async () => {
    vi.useFakeTimers();
    agentWrites("a", "b");
    mocks.disk.delete(PATH);
    scheduleAgentEditsDiskCheck(PATH);
    await vi.runAllTimersAsync();

    expect(entry()).toBeUndefined();
  });
});

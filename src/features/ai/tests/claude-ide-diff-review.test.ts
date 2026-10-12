import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createStore } from "zustand/vanilla";
import {
  acceptClaudeDiff,
  cancelClaudeDiff,
  closeAllClaudeDiffs,
  openClaudeDiff,
  rejectClaudeDiff,
  useClaudeDiffReviewStore,
} from "@/features/ai/integrations/claude-code/services/claude-ide-diff-review";

interface FakeBuffer {
  id: string;
  path: string;
  name: string;
  diffData: unknown;
}

const mocks = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  store: null as unknown,
}));

vi.mock("@/features/file-system/api/file-operations", () => ({
  readFileContent: async (path: string) => {
    const text = mocks.disk.get(path);
    if (text === undefined) throw new Error("not found");
    return text;
  },
}));
vi.mock("@/features/workspace/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: "/repo" }) },
}));
vi.mock("@/features/editor/services/buffer-store-owner", () => ({
  captureBufferStoreOwner: () => ({ workspaceId: "w", store: mocks.store }),
}));

function createBufferStore() {
  return createStore<{
    buffers: FakeBuffer[];
    actions: Record<string, (...args: never[]) => unknown>;
  }>()((set, get) => ({
    buffers: [],
    actions: {
      openBuffer: ((path: string, name: string, ...rest: unknown[]) => {
        const id = `buffer-${get().buffers.length + 1}`;
        set({ buffers: [...get().buffers, { id, path, name, diffData: rest[5] }] });
        return id;
      }) as never,
      closeBufferForce: ((id: string) =>
        set({ buffers: get().buffers.filter((buffer) => buffer.id !== id) })) as never,
    },
  }));
}

type BufferStore = ReturnType<typeof createBufferStore>;

function bufferStore(): BufferStore {
  return mocks.store as BufferStore;
}

async function open(requestId = "r1") {
  const result = openClaudeDiff({
    requestId,
    oldFilePath: "/repo/a.ts",
    newFilePath: "/repo/a.ts",
    newContents: "new\n",
    tabName: `tab-${requestId}`,
  });
  await vi.waitFor(() => expect(bufferStore().getState().buffers.length).toBeGreaterThan(0));
  const review = Object.values(useClaudeDiffReviewStore.getState().reviews).find(
    (item) => item.requestId === requestId,
  );
  if (!review) throw new Error("no review registered");
  return { result, bufferId: review.bufferId };
}

describe("Claude Code diff review", () => {
  beforeEach(() => {
    mocks.disk = new Map([["/repo/a.ts", "old\n"]]);
    mocks.store = createBufferStore();
    closeAllClaudeDiffs();
  });

  it("opens a diff of the file on disk against Claude's contents", async () => {
    const { bufferId } = await open();
    const buffer = bufferStore().getState().buffers[0];
    expect(buffer?.path).toBe("diff://claude-code/r1");
    expect(buffer?.name).toBe("tab-r1");
    expect(buffer?.diffData).toMatchObject({
      commitHash: "claude-code-proposal",
      totalAdditions: 1,
      totalDeletions: 1,
      files: [{ file_path: "a.ts" }],
    });
    rejectClaudeDiff(bufferId);
  });

  it("answers FILE_SAVED with the contents when accepted and closes the tab", async () => {
    const { result, bufferId } = await open();
    expect(acceptClaudeDiff(bufferId)).toBe(true);
    await expect(result).resolves.toEqual(["FILE_SAVED", "new\n"]);
    expect(bufferStore().getState().buffers).toEqual([]);
    expect(useClaudeDiffReviewStore.getState().reviews).toEqual({});
    expect(rejectClaudeDiff(bufferId)).toBe(false);
  });

  it("answers DIFF_REJECTED when rejected or when the user closes the tab", async () => {
    const first = await open("r1");
    rejectClaudeDiff(first.bufferId);
    await expect(first.result).resolves.toEqual(["DIFF_REJECTED", "tab-r1"]);

    const second = await open("r2");
    bufferStore()
      .getState()
      .actions.closeBufferForce?.(second.bufferId as never);
    await expect(second.result).resolves.toEqual(["DIFF_REJECTED", "tab-r2"]);
  });

  it("closes the tab without answering when Claude cancels", async () => {
    const { result } = await open();
    const settled = vi.fn();
    void result.then(settled);
    expect(cancelClaudeDiff("r1")).toBe(true);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(bufferStore().getState().buffers).toEqual([]);
  });

  it("treats a missing file as new", async () => {
    mocks.disk.clear();
    const { bufferId } = await open();
    expect(bufferStore().getState().buffers[0]?.diffData).toMatchObject({
      totalDeletions: 0,
      files: [{ is_new: true }],
    });
    expect(closeAllClaudeDiffs()).toBe(1);
    expect(bufferId).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { usePaneStore } from "@/features/panes/stores/pane.store";

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

describe("buffer open lifecycle", () => {
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
  });

  afterEach(async () => {
    usePaneStore.getState().actions.reset();
    const { useBufferStore } = await import("../stores/buffer.store");
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
  });

  it("reuses pull request buffers and refreshes navigation metadata", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const actions = useBufferStore.getState().actions;
    const firstId = actions.openPRBuffer(42, {
      repoPath: "/workspace",
      title: "Initial title",
    });

    actions.openExtensionBuffer("athas.typescript", "TypeScript");
    const reopenedId = actions.openPRBuffer(42, {
      repoPath: "/workspace",
      title: "Updated title",
      authorAvatarUrl: "https://example.com/avatar.png",
      selectedFilePath: "src/app.ts",
    });

    expect(reopenedId).toBe(firstId);
    expect(useBufferStore.getState().activeBufferId).toBe(firstId);
    expect(useBufferStore.getState().buffers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstId,
          type: "pullRequest",
          path: "pr://42?file=src%2Fapp.ts",
          name: "Updated title",
          repoPath: "/workspace",
          authorAvatarUrl: "https://example.com/avatar.png",
          isActive: true,
        }),
        expect.objectContaining({
          type: "extension",
          isActive: false,
        }),
      ]),
    );
  });

  it("keeps pull requests from different repositories in separate buffers", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const actions = useBufferStore.getState().actions;

    const firstId = actions.openPRBuffer(42, { repoPath: "/workspace-a" });
    const secondId = actions.openPRBuffer(42, { repoPath: "/workspace-b" });

    expect(secondId).not.toBe(firstId);
    expect(
      useBufferStore.getState().buffers.filter((buffer) => buffer.type === "pullRequest"),
    ).toHaveLength(2);
  });

  it("reuses issue and action buffers while refreshing their URLs and titles", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const actions = useBufferStore.getState().actions;
    const issueId = actions.openGitHubIssueBuffer({
      issueNumber: 7,
      repoPath: "/workspace",
      title: "Old issue",
    });
    const actionId = actions.openGitHubActionBuffer({
      runId: 99,
      repoPath: "/workspace",
      title: "Old run",
    });

    expect(
      actions.openGitHubIssueBuffer({
        issueNumber: 7,
        repoPath: "/workspace",
        title: "New issue",
        url: "https://github.com/athasdev/athas/issues/7",
      }),
    ).toBe(issueId);
    expect(
      actions.openGitHubActionBuffer({
        runId: 99,
        repoPath: "/workspace",
        title: "New run",
        url: "https://github.com/athasdev/athas/actions/runs/99",
      }),
    ).toBe(actionId);

    expect(useBufferStore.getState().buffers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: issueId,
          type: "githubIssue",
          name: "New issue",
          path: "https://github.com/athasdev/athas/issues/7",
          url: "https://github.com/athasdev/athas/issues/7",
          isActive: false,
        }),
        expect.objectContaining({
          id: actionId,
          type: "githubAction",
          name: "New run",
          path: "https://github.com/athasdev/athas/actions/runs/99",
          url: "https://github.com/athasdev/athas/actions/runs/99",
          isActive: true,
        }),
      ]),
    );
  });

  it("updates an existing diff buffer instead of opening a duplicate", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const actions = useBufferStore.getState().actions;
    const firstId = actions.openContent({
      type: "diff",
      path: "diff://unstaged/src%2Fapp.ts",
      name: "app.ts (unstaged)",
      content: "old diff",
    });
    const reopenedId = actions.openContent({
      type: "diff",
      path: "diff://unstaged/src%2Fapp.ts",
      name: "app.ts (updated)",
      content: "new diff",
    });

    expect(reopenedId).toBe(firstId);
    expect(useBufferStore.getState().buffers).toEqual([
      expect.objectContaining({
        id: firstId,
        type: "diff",
        name: "app.ts (updated)",
        content: "new diff",
        savedContent: "new diff",
        isActive: true,
      }),
    ]);
  });
});

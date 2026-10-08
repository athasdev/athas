// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { publishEditorDocumentChange } from "@/features/editor/services/editor-document-events";
import type { EditorDocumentChangeEvent } from "@/features/editor/types/editor.types";
import type { ResolvedGitBlame } from "../api/git-blame-api";
import { emitGitChanged } from "../events/git-events";
import type { GitBlame } from "../types/git.types";

const mocks = vi.hoisted(() => ({
  content: "one\ntwo\n",
  otherWorkspaceContent: "other workspace\n",
  scopeId: null as string | null,
  resolve: vi.fn(),
  prewarm: vi.fn(),
  blameStore: null as null | {
    getState: () => { actions: { clearAllBlame: () => void } };
  },
}));

vi.mock("@/features/workspace/stores/create-workspace-scoped-store", () => ({
  createWorkspaceScopedStore: () => ({}),
  useWorkspaceStoreScopeId: () => mocks.scopeId,
}));
vi.mock("@/features/editor/stores/buffer.store", () => {
  const otherBuffers = [
    { id: "virtual", type: "editor", path: "diff://x", isVirtual: true },
    { id: "terminal", type: "terminal", path: "/repo/terminal" },
    ...["a", "b", "c", "d", "e"].map((name) => ({
      id: name,
      type: "editor",
      path: `/repo/src/${name}.ts`,
      isVirtual: false,
    })),
  ];
  const storeWith = (content: () => string) => ({
    getState: () => ({
      buffers: [
        { id: "buffer-1", type: "editor", path: "/repo/src/app.ts", content: content() },
        ...otherBuffers,
      ],
    }),
  });
  return {
    useBufferStore: {
      ...storeWith(() => mocks.otherWorkspaceContent),
      getStore: (workspaceId: string) =>
        storeWith(() => (workspaceId === "editor-workspace" ? mocks.content : "wrong workspace")),
    },
  };
});
vi.mock("@/features/editor/stores/buffer-index", () => ({
  getBufferById: (buffers: Array<{ id: string }>, id: string) =>
    buffers.find((buffer) => buffer.id === id),
}));
vi.mock("@/features/workspace/stores/project.store", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) => selector({ rootFolderPath: "/repo" }),
}));
vi.mock("../api/git-blame-api", () => ({
  getResolvedGitBlame: mocks.resolve,
  prewarmGitBlame: mocks.prewarm,
}));
vi.mock("../stores/git-blame.store", async () => {
  const actual = await vi.importActual<typeof import("../stores/git-blame.store")>(
    "../stores/git-blame.store",
  );
  const { useStore } = await import("zustand");
  const store = actual.createGitBlameStore();
  mocks.blameStore = store;
  return {
    getGitBlameCacheKey: actual.getGitBlameCacheKey,
    useGitBlameStore: (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
      useStore(store, selector),
  };
});

const { canGitChangeAffectBlame, useGitBlame } = await import("../hooks/use-git-blame");

const FILE = "/repo/src/app.ts";

function blameBy(author: string): ResolvedGitBlame {
  const blame: GitBlame = {
    file_path: "src/app.ts",
    lines: [
      {
        line_number: 1,
        total_lines: 2,
        commit_hash: "abc",
        is_uncommitted: false,
        author,
        email: "ada@example.com",
        time: 0,
        commit: "Add app",
      },
    ],
  };
  return { blame, repoPath: "/repo", filePath: "src/app.ts" };
}

let root: Root;
let renders = 0;
let latest: ReturnType<typeof useGitBlame>;

function Harness({ filePath }: { filePath: string | undefined }) {
  renders += 1;
  latest = useGitBlame(filePath, "buffer-1");
  return null;
}

const show = (filePath: string | undefined) =>
  act(() => root.render(<Harness filePath={filePath} />));
const loadedContents = () => mocks.resolve.mock.calls.map((call) => call[2]);

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function edit(content: string, bufferId = "buffer-1") {
  mocks.content = content;
  publishEditorDocumentChange({ bufferId, filePath: FILE } as EditorDocumentChangeEvent);
}

describe("useGitBlame", () => {
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    mocks.content = "one\ntwo\n";
    mocks.scopeId = "editor-workspace";
    mocks.resolve.mockReset();
    mocks.resolve.mockResolvedValue(blameBy("Ada"));
    mocks.prewarm.mockReset();
    mocks.blameStore?.getState().actions.clearAllBlame();
    renders = 0;
    root = createRoot(document.createElement("div"));
    show(FILE);
    await advance(500);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("loads the editor workspace's latest text once edits pause, without re-rendering", async () => {
    expect(loadedContents()).toEqual(["one\ntwo\n"]);
    expect(mocks.resolve).toHaveBeenLastCalledWith("/repo", FILE, "one\ntwo\n");

    const rendersBeforeTyping = renders;
    act(() => {
      edit("one\ntwo\nt");
      vi.advanceTimersByTime(200);
      edit("one\ntwo\nth");
      vi.advanceTimersByTime(200);
      edit("other buffer", "buffer-2");
      edit("one\ntwo\nthr", "buffer-1");
      vi.advanceTimersByTime(499);
    });
    expect(loadedContents()).toEqual(["one\ntwo\n"]);
    expect(renders).toBe(rendersBeforeTyping);

    await advance(1);
    expect(loadedContents()).toEqual(["one\ntwo\n", "one\ntwo\nthr"]);
  });

  it("ignores saves and fetches, and reloads unchanged text after history changes", async () => {
    act(() => {
      emitGitChanged({ filePath: FILE, scopes: ["working-tree"], source: "save" });
      emitGitChanged({ repoPath: "/repo", scopes: ["refs", "remotes"], source: "fetch" });
    });
    await advance(500);
    expect(loadedContents()).toHaveLength(1);

    mocks.resolve.mockResolvedValue(blameBy("Grace"));
    act(() => {
      emitGitChanged({ repoPath: "/repo", scopes: ["working-tree", "history"], source: "commit" });
    });
    await advance(499);
    expect(latest.getBlameForLine(0)?.author).toBe("Ada");
    await advance(1);
    expect(loadedContents()).toEqual(["one\ntwo\n", "one\ntwo\n"]);
    expect(latest.getBlameForLine(0)?.author).toBe("Grace");
  });

  it("prewarms the shown file and other open files once per history change", async () => {
    await act(async () => {
      emitGitChanged({ filePath: FILE, scopes: ["working-tree"], source: "save" });
    });
    expect(mocks.prewarm).not.toHaveBeenCalled();

    await act(async () => {
      emitGitChanged({ repoPath: "/repo", scopes: ["history"], source: "commit" });
    });
    expect(mocks.prewarm).toHaveBeenCalledTimes(1);
    expect(mocks.prewarm).toHaveBeenCalledWith("/repo", [
      FILE,
      "/repo/src/a.ts",
      "/repo/src/b.ts",
      "/repo/src/c.ts",
      "/repo/src/d.ts",
    ]);
  });

  it("still reloads after a history change when the editor is hidden mid-debounce", async () => {
    mocks.resolve.mockResolvedValue(blameBy("Grace"));
    act(() => {
      emitGitChanged({ repoPath: "/repo", scopes: ["history"], source: "checkout-branch" });
    });
    await advance(200);
    show(undefined);
    await advance(1000);
    expect(loadedContents()).toHaveLength(1);

    show(FILE);
    await advance(500);
    expect(loadedContents()).toEqual(["one\ntwo\n", "one\ntwo\n"]);
    expect(latest.getBlameForLine(0)?.author).toBe("Grace");
  });

  it("answers only while the blame matches the buffer's text", () => {
    expect(latest.getBlameForLine(1)?.author).toBe("Ada");

    mocks.content = "zero\none\ntwo\n";
    expect(latest.getBlameForLine(1)).toBeNull();
  });

  it("treats changes without scopes as able to move HEAD", () => {
    expect(canGitChangeAffectBlame({})).toBe(true);
    expect(canGitChangeAffectBlame({ scopes: ["repository", "refs"] })).toBe(true);
    expect(canGitChangeAffectBlame({ scopes: ["working-tree", "stashes"] })).toBe(false);
  });
});

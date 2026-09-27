// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { DiffContent, NewTabContent } from "@/features/panes/types/pane-content.types";
import DiffViewer from "../components/diff/git-diff-viewer";
import { getFileDiff } from "../api/git-diff-api";
import type { GitDiff } from "../types/git.types";
import type { MultiFileDiff } from "../types/git-diff.types";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    },
  });
});

vi.mock("../api/git-diff-api", () => ({ getFileDiff: vi.fn() }));
vi.mock("../api/git-remotes-api", () => ({ getRemotes: async () => [] }));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: Object.assign(
    (select: (state: { rootFolderPath: string }) => unknown) => select({ rootFolderPath: "/repo" }),
    { use: { rootFolderPath: () => "/repo" } },
  ),
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: (select: (state: { user: null }) => unknown) => select({ user: null }),
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("@/features/editor/components/toolbar/breadcrumb", () => ({ default: () => null }));
vi.mock("@/features/editor/components/code-editor", () => ({
  default: ({ bufferId }: { bufferId: string }) => {
    const buffer = useBufferStore((state) => state.buffers.find((item) => item.id === bufferId));
    return <pre>{buffer?.type === "editor" ? buffer.content : ""}</pre>;
  },
}));
vi.mock("../components/diff/diff-file-content", () => ({
  DiffFileContent: ({ diff }: { diff: GitDiff }) => <pre>{diff.file_path}</pre>,
}));

function fileDiff(path: string, content = "added line"): GitDiff {
  return {
    file_path: path,
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    lines: [{ line_type: "added", content, new_line_number: 1 }],
  };
}

function diffBuffer(id: string, path: string, diffData: GitDiff | MultiFileDiff): DiffContent {
  return {
    id,
    path,
    name: id,
    type: "diff",
    content: "",
    savedContent: "",
    diffData,
    isPinned: false,
    isPreview: false,
    isActive: false,
  };
}

function commitBuffer(id: string): DiffContent {
  return diffBuffer(id, `diff://commit/${id}/all-files`, {
    commitHash: id,
    files: [fileDiff(`${id}/first.ts`), fileDiff(`${id}/second.ts`)],
    totalFiles: 2,
    totalAdditions: 2,
    totalDeletions: 0,
  });
}

const otherTab: NewTabContent = {
  id: "other",
  path: "new-tab://other",
  name: "Other tab",
  type: "newTab",
  isPinned: false,
  isPreview: false,
  isActive: false,
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useBufferStore.setState({ buffers: [], activeBufferId: null });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function focusTab(id: string | null) {
  await act(async () => useBufferStore.setState({ activeBufferId: id }));
}

describe("Diff pane isolation", () => {
  it("keeps staged and unstaged views of the same file visible when another pane is focused", async () => {
    const staged = diffBuffer(
      "staged",
      "diff://staged/app.ts",
      fileDiff("app.ts", "staged content"),
    );
    const unstaged = diffBuffer(
      "unstaged",
      "diff://unstaged/app.ts",
      fileDiff("app.ts", "unstaged content"),
    );
    useBufferStore.setState({ buffers: [staged, unstaged, otherTab], activeBufferId: staged.id });
    await act(async () =>
      root.render(
        <>
          <section aria-label="Staged">
            <DiffViewer bufferId={staged.id} />
          </section>
          <section aria-label="Unstaged">
            <DiffViewer bufferId={unstaged.id} />
          </section>
        </>,
      ),
    );

    for (const focused of [otherTab.id, unstaged.id, null, staged.id]) {
      await focusTab(focused);
      const left = container.querySelector('[aria-label="Staged"]')!;
      const right = container.querySelector('[aria-label="Unstaged"]')!;
      expect(left.textContent).toContain("staged content");
      expect(left.textContent).not.toContain("unstaged content");
      expect(right.textContent).toContain("unstaged content");
      expect(container.textContent).not.toContain("No diff data available");
    }

    vi.mocked(getFileDiff).mockResolvedValue(fileDiff("app.ts", "refreshed staged content"));
    await focusTab(otherTab.id);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("athas:git-changed", { detail: { repoPath: "/repo", filePath: "app.ts" } }),
      );
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(container.querySelector('[aria-label="Staged"]')?.textContent).toContain(
      "refreshed staged content",
    );
    expect(useBufferStore.getState().activeBufferId).toBe(otherTab.id);
  });

  it("keeps commit contents scoped to each visible diff tab", async () => {
    const first = commitBuffer("aaaaaaa");
    const second = commitBuffer("bbbbbbb");
    useBufferStore.setState({ buffers: [first, second, otherTab], activeBufferId: first.id });
    await act(async () =>
      root.render(
        <>
          <section aria-label="First commit">
            <DiffViewer bufferId={first.id} />
          </section>
          <section aria-label="Second commit">
            <DiffViewer bufferId={second.id} />
          </section>
        </>,
      ),
    );
    await focusTab(otherTab.id);
    const left = container.querySelector('[aria-label="First commit"]')!;
    const right = container.querySelector('[aria-label="Second commit"]')!;
    expect(left.textContent).toContain("aaaaaaa/first.ts");
    expect(right.textContent).toContain("bbbbbbb/first.ts");
    expect(left.textContent).not.toContain("bbbbbbb/");
    expect(right.textContent).not.toContain("aaaaaaa/");
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === second.id)).toEqual(
      second,
    );
  });
});

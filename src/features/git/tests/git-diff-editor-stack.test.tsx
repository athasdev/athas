// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import type { DiffContent } from "@/features/panes/types/pane-content.types";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import type { GitDiff } from "../types/git.types";
import type { MultiFileDiff } from "../types/git-diff.types";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const mocks = vi.hoisted(() => ({
  getFileDiff: vi.fn(),
  getRemotes: vi.fn(async () => [] as Array<{ name: string; url: string }>),
  openCommitFile: vi.fn(async () => {}),
  openExternalUrl: vi.fn(async () => {}),
  alert: vi.fn(async () => {}),
  fileSelect: vi.fn(),
}));

vi.mock("../api/git-diff-api", () => ({ getFileDiff: mocks.getFileDiff }));
vi.mock("../api/git-remotes-api", () => ({ getRemotes: mocks.getRemotes }));
vi.mock("../utils/open-commit-file-buffer", () => ({ openCommitFileBuffer: mocks.openCommitFile }));
vi.mock("@/utils/external-url", () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showAlertDialog: mocks.alert,
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: (select: (state: unknown) => unknown) =>
    select({ handleFileSelect: mocks.fileSelect }),
}));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: (select: (state: { user: null }) => unknown) => select({ user: null }),
}));
vi.mock("../components/diff/diff-file-content", () => ({
  DiffFileContent: ({
    diff,
    viewMode,
    showWhitespace,
  }: {
    diff: GitDiff;
    viewMode: string;
    showWhitespace: boolean;
  }) => (
    <pre data-diff-content={diff.file_path}>
      {`${diff.file_path} ${viewMode}${showWhitespace ? " whitespace" : ""}`}
    </pre>
  ),
}));

const { default: GitDiffEditorStack } = await import("../components/diff/git-diff-editor-stack");
const { emitGitChanged } = await import("../events/git-events");

const HASH = "abc1234def5678";

function fileDiff(path: string, lines: string[], extra: Partial<GitDiff> = {}): GitDiff {
  return {
    file_path: path,
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    lines: lines.map((content, index) => ({
      line_type: "added",
      content,
      new_line_number: index + 1,
    })),
    ...extra,
  };
}

function commitDiff(extra: Partial<MultiFileDiff> = {}): MultiFileDiff {
  return {
    title: "Commit",
    repoPath: "/repo",
    commitHash: HASH,
    commitMessage: "Rework the parser",
    commitAuthor: "Ada",
    files: [
      fileDiff("src/first.ts", ["const parser = 1;", "const other = 2;"]),
      fileDiff("src/second.ts", ["parser();"], { additions: 4, deletions: 2 }),
    ],
    totalFiles: 2,
    totalAdditions: 6,
    totalDeletions: 2,
    ...extra,
  };
}

function buffer(id: string, path: string, multiDiff: MultiFileDiff): DiffContent {
  return {
    id,
    path,
    name: id,
    type: "diff",
    content: "",
    savedContent: "",
    diffData: multiDiff,
  };
}

let root: Root;
let host: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(multiDiff: MultiFileDiff, path = `diff://commit/${HASH}/all-files`) {
  useBufferStore.setState({ buffers: [buffer("diff", path, multiDiff)] });
  seedActiveBuffer("diff");
  await act(async () => root.render(<GitDiffEditorStack bufferId="diff" multiDiff={multiDiff} />));
  await settle();
}

async function rerender() {
  const current = useBufferStore.getState().buffers[0] as DiffContent;
  await act(async () =>
    root.render(
      <GitDiffEditorStack bufferId="diff" multiDiff={current.diffData as MultiFileDiff} />,
    ),
  );
  await settle();
}

const view = () => within(host);

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!item) throw new Error(`menu item ${label} not found`);
  return item;
}

async function chooseDiffAction(label: string) {
  await click(view().getByRole("button", { name: "Diff actions" }));
  await click(menuItem(label));
}

const searchInput = () => view().getByPlaceholderText("Search changes");

async function search(value: string) {
  await act(async () => {
    fireEvent.change(searchInput(), { target: { value } });
  });
  await settle();
}

async function pressInSearch(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(searchInput(), { key, ...options });
  });
  await settle();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useUIState.setState({ isFindVisible: false });
  useProjectStore.setState({ rootFolderPath: "/repo" });
  mocks.getFileDiff.mockReset();
  mocks.getRemotes.mockReset();
  mocks.getRemotes.mockResolvedValue([]);
  mocks.openCommitFile.mockReset();
  mocks.openExternalUrl.mockReset();
  mocks.alert.mockClear();
  mocks.fileSelect.mockReset();
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  useBufferStore.setState({ buffers: [] });
  vi.unstubAllGlobals();
});

describe("multi-file diff view", () => {
  it("summarizes a commit and its files", async () => {
    await render(commitDiff());

    expect(view().getByText("Rework the parser")).toBeTruthy();
    expect(view().getByText("abc1234")).toBeTruthy();
    expect(view().getByText("2 changed files")).toBeTruthy();
    expect(view().getByText("src/first.ts unified")).toBeTruthy();
    expect(view().getAllByText("+4").length).toBeGreaterThan(0);
  });

  it("switches between unified and split layouts and toggles whitespace", async () => {
    await render(commitDiff());

    await click(view().getByRole("button", { name: "Split view" }));
    expect(view().getByText("src/first.ts split")).toBeTruthy();

    await chooseDiffAction("Show whitespace");
    expect(view().getByText("src/first.ts split whitespace")).toBeTruthy();

    await click(view().getByRole("button", { name: "Unified view" }));
    await chooseDiffAction("Hide whitespace");
    expect(view().getByText("src/first.ts unified")).toBeTruthy();
  });

  it("opens commit files at the commit and reports failures", async () => {
    await render(commitDiff());

    await click(view().getByRole("button", { name: "Open src/first.ts" }));
    expect(mocks.openCommitFile).toHaveBeenCalledWith({
      repoPath: "/repo",
      commitHash: HASH,
      filePath: "src/first.ts",
    });

    mocks.openCommitFile.mockRejectedValueOnce(new Error("missing blob"));
    await chooseDiffAction("Open file at abc1234");
    expect(mocks.alert).toHaveBeenCalledWith(
      expect.stringContaining("at abc1234:\nError: missing blob"),
      "Open Commit File",
    );
  });

  it("links a commit and a comparison to GitHub", async () => {
    mocks.getRemotes.mockResolvedValue([
      { name: "fork", url: "https://github.com/me/athas" },
      { name: "origin", url: "git@github.com:athasdev/athas.git" },
    ]);
    await render(commitDiff());

    await chooseDiffAction("View on GitHub");
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      `https://github.com/athasdev/athas/commit/${HASH}`,
    );

    await act(async () => root.unmount());
    root = createRoot(host);
    mocks.getRemotes.mockResolvedValue([
      { name: "upstream", url: "https://github.com/me/athas.git" },
    ]);
    await render(commitDiff({ commitHash: "main..feature", title: "main..feature" }));

    expect(view().getByText("main..feature")).toBeTruthy();
    await chooseDiffAction("View on GitHub");
    expect(mocks.openExternalUrl).toHaveBeenLastCalledWith(
      "https://github.com/me/athas/compare/main...feature",
    );
  });

  it("does not link stashes or non-GitHub remotes", async () => {
    mocks.getRemotes.mockResolvedValue([{ name: "origin", url: "https://gitlab.com/a/b.git" }]);
    await render(commitDiff());

    await click(view().getByRole("button", { name: "Diff actions" }));
    expect(() => menuItem("View on GitHub")).toThrow();
  });

  it("searches across files and steps through matches", async () => {
    await render(commitDiff());

    await click(view().getByRole("button", { name: "Search changes" }));
    expect(useUIState.getState().isFindVisible).toBe(true);

    await search("parser");
    expect(view().getByText("1 of 2")).toBeTruthy();
    await pressInSearch("Enter");
    expect(view().getByText("2 of 2")).toBeTruthy();
    await pressInSearch("Enter", { shiftKey: true });
    expect(view().getByText("1 of 2")).toBeTruthy();
    await click(view().getByRole("button", { name: "Next match" }));
    await click(view().getByRole("button", { name: "Previous match" }));
    expect(view().getByText("1 of 2")).toBeTruthy();

    await click(view().getByRole("button", { name: "Match case" }));
    await search("PARSER");
    expect(view().getByText("No results")).toBeTruthy();

    await click(view().getByRole("button", { name: "Use regular expression" }));
    await search("(");
    expect(view().getByText("Invalid expression")).toBeTruthy();

    await click(view().getByRole("button", { name: "Match whole word" }));
    await pressInSearch("Escape");
    expect(useUIState.getState().isFindVisible).toBe(false);
  });

  it("opens search and jumps between matches with keyboard shortcuts", async () => {
    await render(commitDiff());

    await act(async () => {
      fireEvent.keyDown(document, { key: "f", metaKey: true });
    });
    await settle();
    expect(useUIState.getState().isFindVisible).toBe(true);

    await search("const");
    expect(view().getByText("1 of 2")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document, { key: "g", ctrlKey: true });
    });
    await settle();
    expect(view().getByText("2 of 2")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document, { key: "g", ctrlKey: true, shiftKey: true });
    });
    await settle();
    expect(view().getByText("1 of 2")).toBeTruthy();

    await click(view().getByRole("button", { name: "Close search" }));
    expect(useUIState.getState().isFindVisible).toBe(false);
  });

  it("remembers the selected file on the buffer", async () => {
    await render(commitDiff());

    const navigator = view().getByLabelText("Changed files");
    await click(within(navigator).getByText("second.ts"));

    const diffData = (useBufferStore.getState().buffers[0] as DiffContent)
      .diffData as MultiFileDiff;
    expect(diffData.selectedFilePath ?? diffData.selectedFileKey).toMatch(/second\.ts/);
  });

  it("shows indexing progress and an empty diff", async () => {
    await render(
      commitDiff({
        files: [],
        isLoading: true,
        indexingProgress: { processed: 1, total: 3, label: "Reading" },
      }),
    );

    expect(view().getByText("0 of 3 changed files")).toBeTruthy();
    expect(view().getAllByText("Reading 1/3").length).toBeGreaterThan(0);

    await act(async () => root.unmount());
    root = createRoot(host);
    await render(commitDiff({ files: [], totalFiles: 0 }));
    expect(view().getByText("No changed files")).toBeTruthy();
  });

  describe("working tree", () => {
    const workingTree = (diff: GitDiff, key = "unstaged:src/app.ts"): MultiFileDiff => ({
      title: "Uncommitted Changes",
      repoPath: "/repo",
      commitHash: "working-tree",
      files: [diff],
      fileKeys: [key],
      totalFiles: 1,
      totalAdditions: 1,
      totalDeletions: 0,
    });

    it("opens the working copy of a changed file", async () => {
      await render(workingTree(fileDiff("src/app.ts", ["x"])), "diff://working-tree/all-files");

      expect(view().getByText("Uncommitted Changes")).toBeTruthy();
      await click(view().getByRole("button", { name: "Open src/app.ts" }));

      expect(mocks.fileSelect).toHaveBeenCalledWith("/repo/src/app.ts", false);
      expect(mocks.getRemotes).not.toHaveBeenCalled();
    });

    it("reloads the file after a git change, falling back to the other index", async () => {
      await render(workingTree(fileDiff("src/app.ts", ["x"])), "diff://working-tree/all-files");
      mocks.getFileDiff
        .mockResolvedValueOnce(fileDiff("src/app.ts", []))
        .mockResolvedValueOnce(fileDiff("src/app.ts", ["staged now"]));

      await act(async () => emitGitChanged({ repoPath: "/repo", filePath: "src/app.ts" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      await settle();

      expect(mocks.getFileDiff.mock.calls).toEqual([
        ["/repo", "src/app.ts", false],
        ["/repo", "src/app.ts", true],
      ]);
      const diffData = (useBufferStore.getState().buffers[0] as DiffContent)
        .diffData as MultiFileDiff;
      expect(diffData.fileKeys).toEqual(["staged:src/app.ts"]);
      await rerender();
      expect(view().getByText("src/app.ts unified")).toBeTruthy();
    });

    it("closes the diff once the file has no changes left", async () => {
      await render(
        workingTree(fileDiff("src/app.ts", ["x"]), "staged:src/app.ts"),
        "diff://working-tree/all-files",
      );
      mocks.getFileDiff.mockResolvedValue(null);

      await act(async () => emitGitChanged({ repoPath: "/repo" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      await settle();

      expect(useBufferStore.getState().buffers).toEqual([]);
    });

    it("ignores changes in other repositories", async () => {
      await render(workingTree(fileDiff("src/app.ts", ["x"])), "diff://working-tree/all-files");

      await act(async () => emitGitChanged({ repoPath: "/elsewhere" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });

      expect(mocks.getFileDiff).not.toHaveBeenCalled();
    });
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FffSearchHit } from "@/features/file-search/lib/file-search-api";
import type { CategorizedFiles, FileItem } from "@/features/file-search/types/file-search.types";
import type { RecentFile } from "@/features/file-system/types/recent-files.types";

const state = vi.hoisted(() => ({
  buffers: [] as Array<{
    id: string;
    type: string;
    isVirtual?: boolean;
    name: string;
    path: string;
  }>,
  activeBufferId: null as string | null,
  recentFiles: [] as RecentFile[],
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock("@/features/panes/hooks/use-pane-buffer-state", () => ({
  useActiveBufferId: () => state.activeBufferId,
}));
vi.mock("@/features/file-system/stores/recent-files.store", () => {
  const actions = { getRecentFilesOrderedByFrecency: () => state.recentFiles };
  return {
    useRecentFilesStore: (selector: (value: { actions: typeof actions }) => unknown) =>
      selector({ actions }),
  };
});

const { useFileSearch } = await import("../hooks/use-file-search");

let container: HTMLDivElement;
let root: Root;
let result: CategorizedFiles;

function file(path: string): FileItem {
  return { name: path.split("/").pop() ?? path, path, isDir: false };
}

function recent(path: string): RecentFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    lastAccessed: "2026-06-15T12:00:00Z",
    accessCount: 1,
    frecencyScore: 1,
    workspacePath: "/repo",
  };
}

function editorBuffer(id: string, path: string, isVirtual = false) {
  return { id, type: "editor", isVirtual, name: path.split("/").pop() ?? path, path };
}

function Harness(props: {
  files: FileItem[];
  query: string;
  hits?: FffSearchHit[] | null;
  useBackendResults?: boolean;
}) {
  result = useFileSearch(props.files, props.query, props.hits ?? null, {
    hasLoadedFiles: true,
    rootFolderPath: "/repo",
    useBackendResults: props.useBackendResults,
  });
  return null;
}

async function search(props: Parameters<typeof Harness>[0]) {
  await act(async () => root.render(<Harness {...props} />));
  return {
    open: result.openBufferFiles.map((item) => item.path),
    recent: result.recentFilesInResults.map((item) => item.path),
    other: result.otherFiles.map((item) => item.path),
  };
}

const workspaceFiles = [
  "/repo/src/zeta.ts",
  "/repo/src/alpha.ts",
  "/repo/src/main.ts",
  "/repo/src/open.ts",
  "/repo/README.md",
].map(file);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.buffers = [
    editorBuffer("active", "/repo/src/main.ts"),
    editorBuffer("open", "/repo/src/open.ts"),
    editorBuffer("scratch", "untitled-1", true),
  ];
  state.activeBufferId = "active";
  state.recentFiles = [
    recent("/repo/src/open.ts"),
    recent("/repo/src/zeta.ts"),
    recent("/repo/src/deleted.ts"),
    { ...recent("/other/src/elsewhere.ts"), workspacePath: "/other" },
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("quick open file search", () => {
  it("lists open files, then recent workspace files, then everything else by name", async () => {
    expect(await search({ files: workspaceFiles, query: "" })).toEqual({
      open: ["/repo/src/open.ts"],
      recent: ["/repo/src/zeta.ts"],
      other: ["/repo/src/alpha.ts", "/repo/README.md"],
    });
  });

  it("treats a whitespace query like an empty one", async () => {
    const empty = await search({ files: workspaceFiles, query: "" });

    expect(await search({ files: workspaceFiles, query: "   " })).toEqual(empty);
  });

  it("ranks fuzzy matches by group and leaves out the active file", async () => {
    expect(await search({ files: workspaceFiles, query: ".ts" })).toEqual({
      open: ["/repo/src/open.ts"],
      recent: ["/repo/src/zeta.ts"],
      other: ["/repo/src/alpha.ts"],
    });
  });

  it("uses backend search hits when they are available", async () => {
    const hits: FffSearchHit[] = [
      { path: "/repo/README.md", name: "README.md", relative_path: "README.md", score: 10 },
    ];

    expect(await search({ files: workspaceFiles, query: "zeta", hits })).toEqual({
      open: [],
      recent: [],
      other: ["/repo/README.md"],
    });
  });

  it("falls back to local fuzzy search when the backend returns nothing", async () => {
    expect(await search({ files: workspaceFiles, query: "alpha", hits: [] })).toEqual({
      open: [],
      recent: [],
      other: ["/repo/src/alpha.ts"],
    });
  });

  it("shows no results instead of local matches when backend results are authoritative", async () => {
    expect(
      await search({ files: workspaceFiles, query: "alpha", hits: [], useBackendResults: true }),
    ).toEqual({ open: [], recent: [], other: [] });
  });
});

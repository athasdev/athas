import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import type { FileEntry } from "@/features/file-system/types/app.types";
import {
  loadProviderSearchFiles,
  searchProviderFilesContent,
} from "../services/provider-content-search";
vi.mock("../services/search-worker-client", async () => {
  const { executeSearchTask } = await import("../workers/search-worker-execution");
  return {
    createSearchWorkerSession: () => ({
      run: async (task: Parameters<typeof executeSearchTask>[0]) => executeSearchTask(task),
      dispose: () => {},
    }),
  };
});
const io = vi.hoisted(() => ({ directory: vi.fn(), read: vi.fn() }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readDirectory: io.directory, readText: io.read }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
const root = "remote://connection/w";
const store = () => useFileSystemStore.getStore("owner");
const projectStore = () => useProjectStore.getStore("owner");
function file(name: string, path = `${root}/${name}`, isDir = false): FileEntry {
  return { name, path, isDir };
}
function search(
  files = [file("a.ts"), file("b.ts")],
  extra: Partial<Parameters<typeof searchProviderFilesContent>[0]> = {},
) {
  return searchProviderFilesContent({
    files,
    query: "foo",
    rootFolderPath: root,
    options: { caseSensitive: true, wholeWord: false, useRegex: false },
    maxResults: 140,
    fileOffset: 0,
    contextLines: 2,
    includeQuery: "",
    excludeQuery: "",
    isCancelled: () => false,
    ...extra,
  });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  projectStore().setState({ rootFolderPath: root, workspaceFolders: [] });
  store().setState({
    projectFilesCache: { path: root, files: [file("stale.ts")], timestamp: Date.now() },
  });
  io.directory.mockReset().mockResolvedValue([]);
  io.read.mockReset().mockResolvedValue("before\nfoo\nafter");
});
describe("provider search enumeration", () => {
  it("loads fresh nested entries instead of using the project file cache", async () => {
    io.directory.mockImplementation(async (path) =>
      path === root ? [file("src", `${root}/src`, true)] : [file("new.ts", `${root}/src/new.ts`)],
    );
    expect((await loadProviderSearchFiles(projectStore()))?.map((entry) => entry.path)).toEqual([
      `${root}/src/new.ts`,
    ]);
    expect(io.directory).toHaveBeenCalledWith(root, root);
    expect(store().getState().projectFilesCache?.files[0]?.name).toBe("stale.ts");
  });
  it("enumerates every captured workspace root and deduplicates overlapping roots", async () => {
    const second = "wsl://d/work";
    const third = "/local";
    projectStore().setState({
      workspaceFolders: [
        { name: "nested", path: `${root}/src` },
        { name: "second", path: second },
        { name: "third", path: third },
      ],
    });
    io.directory.mockImplementation(async (path) =>
      path === root
        ? [file("src", `${root}/src`, true), file("a.ts")]
        : [file("b.ts", `${path}/b.ts`)],
    );
    const files = await loadProviderSearchFiles(projectStore());
    expect(files?.map((entry) => entry.path)).toEqual([
      `${root}/a.ts`,
      `${second}/b.ts`,
      `${third}/b.ts`,
      `${root}/src/b.ts`,
    ]);
    expect(io.directory.mock.calls.filter((args) => args[0] === `${root}/src`)).toHaveLength(1);
  });
  it("skips ignored entries and symlinks without following cycles or reading outside targets", async () => {
    io.directory.mockResolvedValue(
      [
        file(".env"),
        file("node_modules", `${root}/node_modules`, true),
        file("ignored.ts"),
        { ...file("linked", `${root}/linked`, true), isSymlink: true },
      ].map((entry) => (entry.name === "ignored.ts" ? { ...entry, ignored: true } : entry)),
    );
    expect((await loadProviderSearchFiles(projectStore()))?.map((entry) => entry.name)).toEqual([
      ".env",
    ]);
    expect(io.directory).toHaveBeenCalledTimes(1);
  });
  it("reports failed nested directories instead of declaring a partial scan complete", async () => {
    io.directory.mockImplementation(async (path) => {
      if (path === root) return [file("unreadable", `${root}/unreadable`, true), file("a.ts")];
      throw new Error("permission denied");
    });
    await expect(loadProviderSearchFiles(projectStore())).rejects.toThrow(
      `${root}/unreadable: permission denied`,
    );
  });
  it.each(["remote://connection/other/secret", `${root}/../secret`, "remote://another/w/secret"])(
    "refuses a returned path outside the root: %s",
    async (path) => {
      io.directory.mockResolvedValue([file("secret", path)]);
      await expect(loadProviderSearchFiles(projectStore())).rejects.toThrow(
        "outside its search root",
      );
    },
  );
  it("retains literal backslashes in POSIX filenames", async () => {
    io.directory.mockResolvedValue([file("a\\b.ts")]);
    expect((await loadProviderSearchFiles(projectStore()))?.[0]?.path).toBe(`${root}/a\\b.ts`);
  });
  it("bounds directory read concurrency", async () => {
    let active = 0;
    let peak = 0;
    io.directory.mockImplementation(async (path) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return path === root
        ? [...Array(24).keys()].map((index) => file(`dir${index}`, `${root}/dir${index}`, true))
        : [];
    });
    await loadProviderSearchFiles(projectStore());
    expect(peak).toBe(8);
    expect(io.directory).toHaveBeenCalledTimes(25);
  });
  it("cancels before I/O and before starting discovered directories", async () => {
    await expect(
      loadProviderSearchFiles(projectStore(), { isCancelled: () => true }),
    ).resolves.toBeNull();
    expect(io.directory).not.toHaveBeenCalled();
    const read = deferred<FileEntry[]>();
    let cancelled = false;
    io.directory.mockReturnValueOnce(read.promise);
    const pending = loadProviderSearchFiles(projectStore(), { isCancelled: () => cancelled });
    cancelled = true;
    read.resolve([file("src", `${root}/src`, true)]);
    await expect(pending).resolves.toBeNull();
    expect(io.directory).toHaveBeenCalledTimes(1);
  });
});
describe("provider search content and pagination", () => {
  it("keeps successful results while reporting unreadable files", async () => {
    io.read.mockImplementation(async (path) => {
      if (path.endsWith("b.ts")) throw new Error("offline");
      return "foo";
    });
    const page = await search();
    expect(page?.results.map((result) => result.file_path)).toEqual([`${root}/a.ts`]);
    expect(page?.unreadable_files).toBe(1);
    expect(page?.first_read_error).toContain("b.ts: offline");
    expect(page?.searched_files).toBe(2);
  });
  it("paginates from the last processed file and reads filtered paths only", async () => {
    const files = [file("a.ts"), file("skip.md"), file("b.ts"), file("c.ts")];
    const first = await search(files, { includeQuery: "*.ts", maxResults: 1 });
    expect(first?.results[0]?.file_path).toBe(`${root}/a.ts`);
    expect(first?.next_file_offset).toBe(1);
    expect(first?.has_more).toBe(true);
    const next = await search(files, {
      includeQuery: "*.ts",
      fileOffset: first?.next_file_offset ?? 0,
      maxResults: 1,
    });
    expect(next?.results[0]?.file_path).toBe(`${root}/b.ts`);
    expect(io.read.mock.calls.some((args) => args[0].endsWith("skip.md"))).toBe(false);
  });
  it("bounds text read concurrency and prevents more reads after cancellation", async () => {
    const reads = deferred<string>();
    let cancelled = false;
    io.read.mockReturnValue(reads.promise);
    const pending = search(
      [...Array(30).keys()].map((index) => file(`${index}.ts`)),
      { isCancelled: () => cancelled },
    );
    expect(io.read).toHaveBeenCalledTimes(8);
    cancelled = true;
    reads.resolve("foo");
    await expect(pending).resolves.toBeNull();
    expect(io.read).toHaveBeenCalledTimes(8);
  });
  it("reports literal fallback results for an invalid expression", async () => {
    io.read.mockResolvedValue("foo[ and foo");
    const page = await search([file("a.ts")], {
      query: "foo[",
      options: { caseSensitive: true, wholeWord: false, useRegex: true },
    });
    expect(page?.regex_fallback_error).toBe("Invalid regular expression");
    expect(page?.results[0]?.matches[0]?.match_ranges).toEqual([{ start: 0, end: 4 }]);
  });
  it("keeps UTF-16 match positions and line numbers across CRLF and lone CR", async () => {
    io.read.mockResolvedValue("first\r\n😀foo\rthird");
    const page = await search([file("a.ts")]);
    expect(page?.results[0]?.matches[0]).toEqual(
      expect.objectContaining({
        line_number: 2,
        line_content: "😀foo",
        column_start: 2,
        column_end: 5,
        context_before: ["first"],
        context_after: ["third"],
      }),
    );
  });
  it("does not read empty queries, filtered-out paths or exhausted pages", async () => {
    expect((await search([file("a.ts")], { query: "" }))?.results).toEqual([]);
    expect((await search([file("a.ts")], { includeQuery: "*.md" }))?.results).toEqual([]);
    expect((await search([file("a.ts")], { fileOffset: 1 }))?.results).toEqual([]);
    expect(io.read).not.toHaveBeenCalled();
  });
  it("skips known binary assets while preserving SVG and unknown text sources", async () => {
    const files = [
      file("logo.png"),
      file("manual.pdf"),
      file("font.woff"),
      file("movie.mp4"),
      file("recording.mp3"),
      file("data.sqlite"),
      file("vector.svg"),
      file("custom.unknown"),
    ];
    const page = await search(files);
    expect(page?.results.map((result) => result.file_path)).toEqual([
      `${root}/vector.svg`,
      `${root}/custom.unknown`,
    ]);
    expect(page?.unreadable_files).toBe(0);
    expect(io.read.mock.calls.map((args) => args[0])).toEqual([
      `${root}/vector.svg`,
      `${root}/custom.unknown`,
    ]);
    io.directory.mockResolvedValue(files);
    expect((await loadProviderSearchFiles(projectStore()))?.map((entry) => entry.name)).toEqual([
      "vector.svg",
      "custom.unknown",
    ]);
  });
  it("caps a no-match page so large scans can yield and resume", async () => {
    io.read.mockResolvedValue("no matching text");
    const files = [...Array(300).keys()].map((index) => file(`${index}.ts`));
    const page = await search(files);
    expect(page?.searched_files).toBe(250);
    expect(page?.next_file_offset).toBe(250);
    expect(page?.has_more).toBe(true);
    const last = await search(files, { fileOffset: 250 });
    expect(last?.searched_files).toBe(50);
    expect(last?.has_more).toBe(false);
  });
});

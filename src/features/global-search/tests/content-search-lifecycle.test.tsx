// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { WorkspaceStoreScopeContext } from "@/features/workspace/stores/create-workspace-scoped-store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useGlobalSearchSessionStore } from "../stores/global-search-session.store";
import { useContentSearch } from "../hooks/use-content-search";
import type { SearchFilesResponse } from "@/features/file-search/lib/file-search-api";
const io = vi.hoisted(() => ({
  search: vi.fn(),
  scan: vi.fn(),
  files: vi.fn(),
  providerSearch: vi.fn(),
}));
vi.mock("@/features/file-search/lib/file-search-api", () => ({
  searchFilesContent: io.search,
  fffScanStatus: io.scan,
  fffListFiles: vi.fn(),
}));
vi.mock("../services/provider-content-search", () => ({
  loadProviderSearchFiles: io.files,
  searchProviderFilesContent: io.providerSearch,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
let root: Root;
let container: HTMLDivElement;
let search: ReturnType<typeof useContentSearch>;
function Harness({ workspaceId = "owner" }: { workspaceId?: string }) {
  return (
    <WorkspaceStoreScopeContext.Provider value={workspaceId}>
      <Search />
    </WorkspaceStoreScopeContext.Provider>
  );
}
function Search() {
  search = useContentSearch();
  return null;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function response(path = "/w/a.ts", more = false): SearchFilesResponse {
  return {
    results: [
      {
        file_path: path,
        total_matches: 1,
        matches: [{ line_number: 1, line_content: "foo", column_start: 0, column_end: 3 }],
      },
    ],
    total_files: 2,
    searched_files: 1,
    searchable_files: 2,
    files_with_matches: 1,
    next_file_offset: more ? 1 : 0,
    has_more: more,
    is_indexing: false,
    indexed_files: 2,
    regex_fallback_error: null,
  };
}
function setupWorkspace(id: string, path = "/w") {
  workspaceRuntimeRegistry.ensureWorkspace({ id, name: id });
  useProjectStore.getStore(id).setState({ rootFolderPath: path, workspaceFolders: [] });
  useGlobalSearchSessionStore.getStore(id).getState().actions.setQuery("foo");
}
async function mount(id = "owner") {
  await act(async () => root.render(<Harness workspaceId={id} />));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  workspaceRuntimeRegistry.resetForTests();
  setupWorkspace("owner");
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  io.search.mockReset().mockResolvedValue(response());
  io.scan.mockReset();
  io.files.mockReset().mockResolvedValue([]);
  io.providerSearch.mockReset().mockResolvedValue(response("wsl://d/w/a.ts"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("content search ownership and requests", () => {
  it("keeps native roots with a parked workspace", async () => {
    setupWorkspace("other", "/other");
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    await mount();
    expect(io.search).toHaveBeenCalledWith(
      expect.objectContaining({ root_paths: ["/w"] }),
      expect.any(Object),
    );
    expect(search.results[0]?.file_path).toBe("/w/a.ts");
  });
  it("enumerates provider files from the parked owner", async () => {
    useProjectStore.getStore("owner").setState({ rootFolderPath: "wsl://d/w" });
    setupWorkspace("other", "wsl://d/other");
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    await mount();
    expect(io.files).toHaveBeenCalledWith(
      useProjectStore.getStore("owner"),
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
    expect(io.providerSearch).toHaveBeenCalledWith(
      expect.objectContaining({ rootFolderPath: "wsl://d/w" }),
    );
  });
  it("ignores an old page when the view changes workspace", async () => {
    const old = deferred<SearchFilesResponse>();
    io.search.mockReturnValueOnce(old.promise);
    await mount();
    setupWorkspace("other", "/other");
    io.search.mockResolvedValue(response("/other/new.ts"));
    await mount("other");
    await act(async () => old.resolve(response("/w/old.ts")));
    expect(search.results[0]?.file_path).toBe("/other/new.ts");
    expect(search.isSearching).toBe(false);
  });
  it("rejects the old page before a changed input finishes debouncing", async () => {
    vi.useFakeTimers();
    const old = deferred<SearchFilesResponse>();
    io.search.mockReturnValueOnce(old.promise);
    await mount();
    await act(async () => search.setQuery("bar"));
    await act(async () => old.resolve(response("/w/old.ts")));
    expect(search.results).toEqual([]);
    expect(search.isSearchPending).toBe(true);
    expect(io.search).toHaveBeenCalledTimes(1);
    io.search.mockResolvedValue(response("/w/new.ts"));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(search.results[0]?.file_path).toBe("/w/new.ts");
    expect(io.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "bar" }),
      expect.any(Object),
    );
  });
  it("prevents retained callbacks from launching work after unmount", async () => {
    await mount();
    const oldRefresh = search.refreshSearch;
    const oldMore = search.loadMoreResults;
    await act(async () => root.render(null));
    await act(async () => {
      await oldRefresh();
      await oldMore();
    });
    expect(io.search).toHaveBeenCalledTimes(1);
  });
  it("stops provider reading after enumeration completes on a disposed view", async () => {
    useProjectStore.getStore("owner").setState({ rootFolderPath: "wsl://d/w" });
    const files = deferred<[]>();
    io.files.mockReturnValueOnce(files.promise);
    await mount();
    await act(async () => root.render(null));
    await act(async () => files.resolve([]));
    expect(io.providerSearch).not.toHaveBeenCalled();
  });
  it("does not accept an old owner recreated with the same ID", async () => {
    const old = deferred<SearchFilesResponse>();
    io.search.mockReturnValueOnce(old.promise);
    await mount();
    io.search.mockResolvedValue(response("/w/recreated.ts"));
    await act(async () => {
      workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
      workspaceRuntimeRegistry.removeWorkspace("owner");
      setupWorkspace("owner");
    });
    await act(async () => old.resolve(response("/w/old.ts")));
    expect(search.results[0]?.file_path).toBe("/w/recreated.ts");
  });
  it("coalesces duplicate Load More clicks before React updates", async () => {
    io.search.mockResolvedValueOnce(response("/w/a.ts", true));
    await mount();
    const next = deferred<SearchFilesResponse>();
    io.search.mockReturnValueOnce(next.promise);
    let first = Promise.resolve();
    let second = Promise.resolve();
    await act(async () => {
      first = search.loadMoreResults();
      second = search.loadMoreResults();
    });
    expect(io.search).toHaveBeenCalledTimes(2);
    await act(async () => {
      next.resolve(response("/w/b.ts"));
      await Promise.all([first, second]);
    });
    expect(search.results.map((result) => result.file_path)).toEqual(["/w/a.ts", "/w/b.ts"]);
  });
  it("retries a failed provider enumeration instead of keeping the rejected cache", async () => {
    useProjectStore.getStore("owner").setState({ rootFolderPath: "wsl://d/w" });
    io.files.mockRejectedValueOnce(new Error("offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await mount();
    expect(search.error).toContain("offline");
    await act(async () => search.refreshSearch());
    expect(io.files).toHaveBeenCalledTimes(2);
    expect(search.error).toBeNull();
    expect(search.results).toHaveLength(1);
    log.mockRestore();
  });
  it("does not reuse provider file lists when owners share the same root", async () => {
    useProjectStore.getStore("owner").setState({ rootFolderPath: "wsl://d/w" });
    await mount();
    setupWorkspace("other", "wsl://d/w");
    await mount("other");
    expect(io.files).toHaveBeenCalledTimes(2);
    expect(io.files).toHaveBeenLastCalledWith(
      useProjectStore.getStore("other"),
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
  });
  it("ignores a late failure after a newer refresh succeeds", async () => {
    const old = deferred<SearchFilesResponse>();
    io.search.mockReturnValueOnce(old.promise);
    await mount();
    io.search.mockResolvedValue(response("/w/refreshed.ts"));
    await act(async () => search.refreshSearch());
    await act(async () => old.reject(new Error("old failure")));
    expect(search.error).toBeNull();
    expect(search.results[0]?.file_path).toBe("/w/refreshed.ts");
    expect(search.isSearching).toBe(false);
  });
  it("does not let a retired refresh callback cancel the new workspace search", async () => {
    await mount();
    const oldRefresh = search.refreshSearch;
    setupWorkspace("other", "/other");
    const next = deferred<SearchFilesResponse>();
    io.search.mockReturnValueOnce(next.promise);
    await mount("other");
    await act(async () => oldRefresh());
    expect(io.search).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(response("/other/new.ts")));
    expect(search.results[0]?.file_path).toBe("/other/new.ts");
  });
  it("searches SSH workspaces through the provider", async () => {
    useProjectStore.getStore("owner").setState({ rootFolderPath: "remote://connection/work" });
    await mount();
    expect(search.availability).toBe("ready");
    expect(io.search).not.toHaveBeenCalled();
    expect(io.providerSearch).toHaveBeenCalledWith(
      expect.objectContaining({ rootFolderPath: "remote://connection/work" }),
    );
  });
  it("routes mixed local and provider roots through one owned search session", async () => {
    useProjectStore
      .getStore("owner")
      .setState({ workspaceFolders: [{ name: "remote", path: "remote://connection/work" }] });
    await mount();
    const originalKey = search.searchKey;
    expect(io.providerSearch).toHaveBeenCalledTimes(1);
    expect(io.search).not.toHaveBeenCalled();
    await act(async () =>
      useProjectStore
        .getStore("owner")
        .setState({ workspaceFolders: [{ name: "remote", path: "remote://connection/another" }] }),
    );
    expect(search.searchKey).not.toBe(originalKey);
    expect(io.files).toHaveBeenCalledTimes(2);
  });
  it("enumerates fresh provider files on each explicit refresh", async () => {
    useProjectStore.getStore("owner").setState({ rootFolderPath: "wsl://d/w" });
    await mount();
    await act(async () => search.refreshSearch());
    expect(io.files).toHaveBeenCalledTimes(2);
  });
  it("retains one provider enumeration across pages in the same search", async () => {
    useProjectStore.getStore("owner").setState({ rootFolderPath: "remote://connection/w" });
    io.providerSearch.mockResolvedValueOnce(response("remote://connection/w/a.ts", true));
    await mount();
    io.providerSearch.mockResolvedValueOnce(response("remote://connection/w/b.ts"));
    await act(async () => search.loadMoreResults());
    expect(io.files).toHaveBeenCalledTimes(1);
    expect(search.results.map((result) => result.file_path)).toEqual([
      "remote://connection/w/a.ts",
      "remote://connection/w/b.ts",
    ]);
  });
  it("cancels provider enumeration as soon as its query changes", async () => {
    useProjectStore.getStore("owner").setState({ rootFolderPath: "remote://connection/w" });
    const files = deferred<[]>();
    io.files.mockReturnValueOnce(files.promise);
    await mount();
    const isCancelled = io.files.mock.calls[0]?.[1].isCancelled;
    expect(isCancelled()).toBe(false);
    await act(async () => search.setQuery("bar"));
    expect(isCancelled()).toBe(true);
    await act(async () => files.resolve([]));
    expect(io.providerSearch).not.toHaveBeenCalled();
  });
  it("accumulates incomplete-page warnings and clears them on refresh", async () => {
    io.search.mockResolvedValueOnce({
      ...response("/w/a.ts", true),
      unreadable_files: 1,
      first_read_error: "/w/private.ts: denied",
      regex_fallback_error: "bad regex",
    });
    await mount();
    io.search.mockResolvedValueOnce({
      ...response("/w/b.ts"),
      unreadable_files: 1,
      first_read_error: "/w/offline.ts: offline",
    });
    await act(async () => search.loadMoreResults());
    expect(search.searchWarning).toContain("2 files could not be read");
    expect(search.searchWarning).toContain("private.ts: denied");
    expect(search.searchWarning).toContain("showing literal matches");
    await act(async () => search.refreshSearch());
    expect(search.searchWarning).toBeNull();
  });
  it("retains read failures from filtered-out pages before a visible result", async () => {
    useGlobalSearchSessionStore.getStore("owner").getState().actions.setIncludeQuery("*.ts");
    io.search.mockResolvedValueOnce({
      ...response("/w/hidden.md", true),
      unreadable_files: 1,
      first_read_error: "/w/private.ts: denied",
    });
    io.search.mockResolvedValueOnce({ ...response("/w/a.ts"), unreadable_files: 1 });
    await mount();
    expect(search.results[0]?.file_path).toBe("/w/a.ts");
    expect(search.searchWarning).toContain("2 files could not be read");
  });
  it("continues beyond empty backend pages even without path filters", async () => {
    io.search.mockResolvedValueOnce({
      ...response("/w/a.ts", true),
      results: [],
      files_with_matches: 0,
    });
    io.search.mockResolvedValueOnce(response("/w/later-match.ts"));
    await mount();
    expect(io.search).toHaveBeenCalledTimes(2);
    expect(search.results[0]?.file_path).toBe("/w/later-match.ts");
    expect(search.searchedFiles).toBe(2);
  });
  it("reports a non-advancing page instead of declaring an incomplete scan finished", async () => {
    io.search.mockResolvedValue({
      ...response("/w/a.ts", true),
      next_file_offset: 0,
      results: [],
      files_with_matches: 0,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await mount();
    expect(search.error).toContain("pagination did not advance");
    expect(io.search).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  channel: null as null | { onmessage: (event: unknown) => void },
  searchFilesContentStream: vi.fn(),
  cancelIpcStream: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (event: unknown) => void;
    constructor(onmessage: (event: unknown) => void) {
      this.onmessage = onmessage;
      io.channel = this;
    }
  },
}));
vi.mock("@/bindings/commands", () => ({
  commands: {
    searchFilesContentStream: io.searchFilesContentStream,
    cancelIpcStream: io.cancelIpcStream,
  },
}));

import { searchFilesContent } from "../lib/file-search-api";

const match = (file_path: string) => ({ file_path, matches: [], total_matches: 1 });
const summary = {
  total_files: 10,
  searched_files: 10,
  searchable_files: 10,
  next_file_offset: 10,
  has_more: false,
  indexed_files: 10,
  regex_fallback_error: null,
  cancelled: false,
};

describe("streamed content search", () => {
  beforeEach(() => {
    io.channel = null;
    io.searchFilesContentStream.mockReset().mockResolvedValue(null);
    io.cancelIpcStream.mockClear();
  });

  it("reports progress and batches as they arrive and resolves with the page", async () => {
    const onIndexing = vi.fn();
    const onResults = vi.fn();
    const page = searchFilesContent(
      { root_paths: ["/w"], query: "foo" },
      { onIndexing, onResults },
    );

    io.channel?.onmessage({ kind: "indexing", scanned_files: 4, indexed_files: 4 });
    io.channel?.onmessage({
      kind: "results",
      results: [match("/w/a.ts")],
      searched_files: 5,
      searchable_files: 10,
    });
    io.channel?.onmessage({
      kind: "results",
      results: [match("/w/b.ts")],
      searched_files: 10,
      searchable_files: 10,
    });
    io.channel?.onmessage({ kind: "done", summary });

    const response = await page;
    expect(onIndexing).toHaveBeenCalledWith(4);
    expect(onResults).toHaveBeenCalledTimes(2);
    expect(response.results.map((result) => result.file_path)).toEqual(["/w/a.ts", "/w/b.ts"]);
    expect(response.files_with_matches).toBe(2);
    expect(response.is_indexing).toBe(false);
    expect(io.searchFilesContentStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: "foo", root_paths: ["/w"], search_id: expect.any(String) }),
      io.channel,
    );
  });

  it("cancels the backend stream once the caller no longer wants it", async () => {
    let wanted = true;
    const page = searchFilesContent(
      { root_paths: ["/w"], query: "foo" },
      { isCancelled: () => !wanted },
    );
    const searchId = io.searchFilesContentStream.mock.calls[0]?.[0].search_id;

    wanted = false;
    io.channel?.onmessage({ kind: "indexing", scanned_files: 1, indexed_files: 1 });
    io.channel?.onmessage({ kind: "done", summary: { ...summary, cancelled: true } });

    await page;
    expect(io.cancelIpcStream).toHaveBeenCalledTimes(1);
    expect(io.cancelIpcStream).toHaveBeenCalledWith(searchId);
  });
});

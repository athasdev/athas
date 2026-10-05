// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  status: { is_scanning: true, indexed_files: 0, scanned_files_count: 0 },
  listFiles: vi.fn(async () => [{ name: "a.ts", path: "/repo/a.ts" }]),
}));

vi.mock("@/features/file-search/lib/file-search-api", () => ({
  fffScanStatus: async () => ({ ...io.status }),
  fffListFiles: io.listFiles,
}));
vi.mock("@/features/file-system/stores/file-system.store", () => {
  const state = {
    rootFolderPath: "/repo",
    workspaceFolders: [],
    getAllProjectFiles: async () => [],
  };
  return { useFileSystemStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

const { useFileLoader } = await import("../hooks/use-file-loader");

function Harness() {
  useFileLoader(true);
  return null;
}

let container: HTMLDivElement;
let root: Root;

describe("quick open file loader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    io.status = { is_scanning: true, indexed_files: 0, scanned_files_count: 0 };
    io.listFiles.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("re-reads the whole list at most every two seconds while indexing, and once when done", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(io.listFiles).toHaveBeenCalledTimes(1);

    // The index grows on every 300 ms poll for 1.5 s: no re-list yet.
    for (let tick = 1; tick <= 5; tick++) {
      io.status = { ...io.status, indexed_files: tick * 100 };
      await act(async () => vi.advanceTimersByTimeAsync(300));
    }
    expect(io.listFiles).toHaveBeenCalledTimes(1);

    io.status = { ...io.status, indexed_files: 900 };
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(io.listFiles).toHaveBeenCalledTimes(2);

    io.status = { is_scanning: false, indexed_files: 1000, scanned_files_count: 1000 };
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(io.listFiles).toHaveBeenCalledTimes(3);

    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(io.listFiles).toHaveBeenCalledTimes(3);
  });
});

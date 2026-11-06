import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  paste: vi.fn(),
  refreshDirectory: vi.fn(async () => {}),
  relocateOpenPaths: vi.fn(),
  clipboard: null as { operation: "copy" | "cut" } | null,
}));

vi.mock("../stores/file-explorer-clipboard.store", () => ({
  useFileClipboardStore: {
    getState: () => ({ clipboard: mocks.clipboard, actions: { paste: mocks.paste } }),
  },
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: {
    getStore: () => ({ getState: () => ({ refreshDirectory: mocks.refreshDirectory }) }),
  },
}));
vi.mock("@/features/file-system/services/relocate-open-paths", () => ({
  relocateOpenPaths: mocks.relocateOpenPaths,
}));

import { pasteFileClipboard } from "../services/paste-file-clipboard";

afterEach(() => {
  vi.clearAllMocks();
});

describe("pasting files from the explorer clipboard", () => {
  it("refreshes only the target after a copy", async () => {
    mocks.clipboard = { operation: "copy" };
    mocks.paste.mockResolvedValue([
      { source_path: "/repo/a.ts", destination_path: "/repo/src/a.ts", is_dir: false },
    ]);

    await pasteFileClipboard("/repo/src", "ws");

    expect(mocks.relocateOpenPaths).not.toHaveBeenCalled();
    expect(mocks.refreshDirectory).toHaveBeenCalledExactlyOnceWith("/repo/src", { force: true });
  });

  it("moves open tabs along after a cut and refreshes the folders the entries left", async () => {
    mocks.clipboard = { operation: "cut" };
    mocks.paste.mockResolvedValue([
      { source_path: "/repo/lib/a.ts", destination_path: "/repo/src/a.ts", is_dir: false },
      { source_path: "/repo/src/b.ts", destination_path: "/repo/src/b.ts", is_dir: false },
    ]);

    await pasteFileClipboard("/repo/src", "ws");

    expect(mocks.relocateOpenPaths).toHaveBeenCalledExactlyOnceWith(
      "ws",
      "/repo/lib/a.ts",
      "/repo/src/a.ts",
    );
    expect(mocks.refreshDirectory).toHaveBeenCalledWith("/repo/src", { force: true });
    expect(mocks.refreshDirectory).toHaveBeenCalledWith("/repo/lib", { force: true });
    expect(mocks.refreshDirectory).toHaveBeenCalledTimes(2);
  });

  it("still refreshes the target when the paste failed", async () => {
    mocks.clipboard = { operation: "cut" };
    mocks.paste.mockResolvedValue(null);

    await pasteFileClipboard("/repo/src", "ws");

    expect(mocks.relocateOpenPaths).not.toHaveBeenCalled();
    expect(mocks.refreshDirectory).toHaveBeenCalledExactlyOnceWith("/repo/src", { force: true });
  });
});

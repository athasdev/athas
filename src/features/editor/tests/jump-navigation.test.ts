import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import type { JumpListEntry } from "../stores/jump-list.store";

const mocks = vi.hoisted(() => ({
  buffers: [] as EditorContent[],
  read: vi.fn(),
  openBuffer: vi.fn(),
  setActiveBuffer: vi.fn(),
  requestNavigation: vi.fn(),
}));
vi.mock("@/features/file-system/api/file-operations", () => ({
  readFileContent: mocks.read,
}));
vi.mock("../stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: mocks.buffers,
      actions: { openBuffer: mocks.openBuffer, setActiveBuffer: mocks.setActiveBuffer },
    }),
  },
}));
vi.mock("../stores/state.store", () => ({
  useEditorStateStore: {
    getState: () => ({ actions: { requestNavigation: mocks.requestNavigation } }),
  },
}));

import { navigateToJumpEntry } from "../services/jump-navigation";

const entry: JumpListEntry = {
  bufferId: "closed",
  filePath: "/repo/b.ts",
  line: 4,
  column: 2,
  offset: 40,
  scrollTop: 0,
  scrollLeft: 0,
  timestamp: 1,
};
const position = { line: 4, column: 2, offset: 40 };

describe("navigateToJumpEntry", () => {
  beforeEach(() => {
    mocks.buffers = [];
    vi.clearAllMocks();
  });

  it("activates an open buffer and requests a centered navigation to the entry", async () => {
    mocks.buffers = [{ id: "open", type: "editor", path: "/repo/b.ts" } as EditorContent];

    await expect(navigateToJumpEntry(entry)).resolves.toBe(true);

    expect(mocks.setActiveBuffer).toHaveBeenCalledWith("open");
    expect(mocks.requestNavigation).toHaveBeenCalledWith({
      bufferId: "open",
      range: { start: position, end: position },
      focus: false,
    });
  });

  it("reopens a closed file and navigates in the new buffer", async () => {
    mocks.read.mockResolvedValue("content");
    mocks.openBuffer.mockReturnValue("reopened");

    await expect(navigateToJumpEntry(entry)).resolves.toBe(true);

    expect(mocks.openBuffer).toHaveBeenCalledWith("/repo/b.ts", "b.ts", "content");
    expect(mocks.requestNavigation).toHaveBeenCalledWith({
      bufferId: "reopened",
      range: { start: position, end: position },
      focus: false,
    });
  });

  it("does not navigate when the file cannot be reopened", async () => {
    mocks.read.mockRejectedValue(new Error("gone"));

    await expect(navigateToJumpEntry(entry)).resolves.toBe(false);
    expect(mocks.requestNavigation).not.toHaveBeenCalled();
  });
});

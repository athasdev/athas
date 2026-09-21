import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  dispatch: vi.fn(),
  updateSession: vi.fn(),
  updateBuffer: vi.fn(),
  terminal: {
    id: "one",
    name: "Shell",
    title: "vite",
    currentDirectory: "/project/app",
    customName: false,
    environment: { SECRET: "do-not-send" },
    selection: "private output",
  },
  workspace: "/project",
}));
vi.mock("@/features/ai/intelligence/services/intelligence-text-service", () => ({
  requestInlineEdit: mocks.request,
}));
vi.mock("../stores/terminal-tabs.store", () => ({
  useTerminalTabsStore: {
    getState: () => ({
      terminals: [mocks.terminal],
      activeTerminalId: "one",
      actions: { dispatch: mocks.dispatch },
    }),
  },
}));
vi.mock("../stores/terminal.store", () => ({
  useTerminalStore: { getState: () => ({ actions: { updateSession: mocks.updateSession } }) },
}));
vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: mocks.workspace }) },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: [{ id: "buffer", type: "terminal", sessionId: "one" }],
      actions: { updateBuffer: mocks.updateBuffer },
    }),
  },
}));
import { renameTerminalWithIntelligence } from "../services/intelligence-terminal-title";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.terminal = { ...mocks.terminal, name: "Shell", customName: false };
  mocks.workspace = "/project";
});
describe("Intelligence terminal names", () => {
  it("uses only terminal title metadata and updates the tab and editor buffer", async () => {
    mocks.request.mockResolvedValue({ editedText: "Dev Server" });
    await renameTerminalWithIntelligence();
    expect(mocks.request.mock.calls[0][0].feature).toBe("terminal-title");
    expect(mocks.request.mock.calls[0][0].selectedText).not.toContain("do-not-send");
    expect(mocks.request.mock.calls[0][0].selectedText).not.toContain("private output");
    expect(mocks.updateBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Dev Server" }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_TERMINAL_NAME",
      payload: { id: "one", name: "Dev Server" },
    });
  });
  it.each(["rename", "workspace"])(
    "does not apply a late result after %s changes",
    async (reason) => {
      let resolve!: (value: { editedText: string }) => void;
      mocks.request.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const pending = renameTerminalWithIntelligence();
      if (reason === "rename")
        mocks.terminal = { ...mocks.terminal, name: "My name", customName: true };
      else mocks.workspace = "/other";
      resolve({ editedText: "Old result" });
      await pending;
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );
  it("rejects control sequences in the generated title", async () => {
    mocks.request.mockResolvedValue({ editedText: "name\u001b[0m" });
    await expect(renameTerminalWithIntelligence()).rejects.toThrow("short terminal title");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

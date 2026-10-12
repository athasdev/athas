import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  openContent: vi.fn(),
  openTerminalBuffer: vi.fn(),
  handleFileSelect: vi.fn(async () => {}),
  handleOpenFolderByPath: vi.fn(async () => {}),
  handleOpenRemoteProject: vi.fn(async () => {}),
  getSymlinkInfo: vi.fn(async () => ({ is_dir: false })),
  showConfirmDialog: vi.fn(async () => true),
  openUrl: vi.fn(async () => {}),
  toastError: vi.fn(),
  waitForBootstrapPhase: vi.fn(async () => {}),
}));

vi.mock("@/features/bootstrap/stores/bootstrap-phase.store", () => ({
  waitForBootstrapPhase: harness.waitForBootstrapPhase,
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: { openContent: harness.openContent, openTerminalBuffer: harness.openTerminalBuffer },
    }),
  },
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: {
    getState: () => ({
      handleFileSelect: harness.handleFileSelect,
      handleOpenFolderByPath: harness.handleOpenFolderByPath,
      handleOpenRemoteProject: harness.handleOpenRemoteProject,
    }),
  },
}));
vi.mock("@/features/file-system/api/file-system-api", () => ({
  getSymlinkInfo: harness.getSymlinkInfo,
}));
vi.mock("@/ui/dialog", () => ({ showConfirmDialog: harness.showConfirmDialog }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: harness.openUrl }));
vi.mock("sonner", () => ({ toast: { error: harness.toastError } }));

import { enqueueWindowOpenRequest } from "../services/window-open-request";

beforeEach(() => {
  vi.clearAllMocks();
  harness.getSymlinkInfo.mockResolvedValue({ is_dir: false });
  harness.showConfirmDialog.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handling window open requests", () => {
  it("waits for settings before opening anything", async () => {
    let releaseSettings!: () => void;
    harness.waitForBootstrapPhase.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseSettings = resolve;
      }),
    );

    const request = enqueueWindowOpenRequest({ path: "/repo/a.ts" });
    await Promise.resolve();
    expect(harness.handleFileSelect).not.toHaveBeenCalled();

    releaseSettings();
    await request;

    expect(harness.waitForBootstrapPhase).toHaveBeenCalledWith("settings-ready");
    expect(harness.handleFileSelect).toHaveBeenCalledWith(
      "/repo/a.ts",
      false,
      undefined,
      undefined,
    );
  });

  it("opens app content but ignores content that came from a deep link", async () => {
    const content = { type: "settings" } as never;

    await enqueueWindowOpenRequest({ content });
    await enqueueWindowOpenRequest({ content, source: "deepLink" });

    expect(harness.openContent).toHaveBeenCalledOnce();
    expect(harness.openContent).toHaveBeenCalledWith(content);
  });

  it("opens web requests in the system browser", async () => {
    await enqueueWindowOpenRequest({ type: "web", url: "https://athas.dev" });

    await vi.waitFor(() => expect(harness.openUrl).toHaveBeenCalledWith("https://athas.dev"));
    expect(harness.handleFileSelect).not.toHaveBeenCalled();
  });

  it("asks before running a terminal command from a deep link", async () => {
    harness.showConfirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const request = {
      type: "terminal" as const,
      source: "deepLink" as const,
      command: "rm -rf build",
      workingDirectory: "/repo",
    };

    await enqueueWindowOpenRequest(request);
    expect(harness.openTerminalBuffer).not.toHaveBeenCalled();
    expect(harness.showConfirmDialog).toHaveBeenCalledWith(
      expect.stringContaining("rm -rf build"),
      expect.objectContaining({ title: "Run Terminal Command" }),
    );

    await enqueueWindowOpenRequest(request);
    expect(harness.openTerminalBuffer).toHaveBeenCalledWith({
      command: "rm -rf build",
      workingDirectory: "/repo",
    });
  });

  it("opens app terminal requests without asking", async () => {
    await enqueueWindowOpenRequest({ type: "terminal", source: "cli", command: "ls" });

    expect(harness.showConfirmDialog).not.toHaveBeenCalled();
    expect(harness.openTerminalBuffer).toHaveBeenCalledWith({
      command: "ls",
      workingDirectory: undefined,
    });
  });

  it("opens remote projects with a fallback name", async () => {
    await enqueueWindowOpenRequest({ type: "remote", remoteConnectionId: "ssh-1" });
    await enqueueWindowOpenRequest({
      type: "remote",
      remoteConnectionId: "ssh-2",
      remoteConnectionName: "Build box",
    });

    expect(harness.handleOpenRemoteProject.mock.calls).toEqual([
      ["ssh-1", "Remote"],
      ["ssh-2", "Build box"],
    ]);
  });

  it("opens remote files directly without checking the local disk", async () => {
    await enqueueWindowOpenRequest({ path: "remote://ssh-1/src/a.ts", line: 3, column: 2 });

    expect(harness.getSymlinkInfo).not.toHaveBeenCalled();
    expect(harness.handleFileSelect).toHaveBeenCalledWith("remote://ssh-1/src/a.ts", false, 3, 2);
  });

  it("opens folders as projects and files at their position", async () => {
    harness.getSymlinkInfo
      .mockResolvedValueOnce({ is_dir: true })
      .mockResolvedValueOnce({ is_dir: false });

    await enqueueWindowOpenRequest({ type: "path", path: "/repo" });
    await enqueueWindowOpenRequest({ type: "path", path: "/repo/a.ts", line: 9, column: 4 });

    expect(harness.handleOpenFolderByPath).toHaveBeenCalledWith("/repo");
    expect(harness.handleFileSelect).toHaveBeenCalledWith("/repo/a.ts", false, 9, 4);
  });

  it("rejects a folder request that points at a file", async () => {
    await enqueueWindowOpenRequest({ type: "path", path: "/repo/a.ts", isDirectory: true });

    expect(harness.toastError).toHaveBeenCalledWith("Path is not a folder. /repo/a.ts");
    expect(harness.handleOpenFolderByPath).not.toHaveBeenCalled();
    expect(harness.handleFileSelect).not.toHaveBeenCalled();
  });

  it("tells the user when a path cannot be read", async () => {
    harness.getSymlinkInfo.mockRejectedValueOnce(new Error("ENOENT"));

    await enqueueWindowOpenRequest({ type: "path", path: "/missing" });

    expect(harness.toastError).toHaveBeenCalledWith(
      'Cannot open "/missing". Check that it exists and is accessible.',
    );
    expect(harness.handleFileSelect).not.toHaveBeenCalled();
  });

  it("does nothing for requests without a target", async () => {
    await enqueueWindowOpenRequest({ type: "path" });
    await enqueueWindowOpenRequest({ type: "remote" });

    expect(harness.handleFileSelect).not.toHaveBeenCalled();
    expect(harness.handleOpenRemoteProject).not.toHaveBeenCalled();
  });
});

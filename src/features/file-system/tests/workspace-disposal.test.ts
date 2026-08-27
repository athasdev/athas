import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { disposeWorkspaceResources } from "../services/workspace-disposal";

const invoke = vi.hoisted(() => vi.fn());
const updateConnectionStatus = vi.hoisted(() => vi.fn());
const closeTerminalConnection = vi.hoisted(() => vi.fn());
const cancelFileWatcherRefreshes = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/features/remote/stores/remote-connection.store", () => ({
  connectionStore: { updateConnectionStatus },
}));
vi.mock("@/features/terminal/services/terminal-connection-lifecycle", () => ({
  closeTerminalConnection,
}));
vi.mock("../services/file-watcher-refresh-scheduler", () => ({
  cancelFileWatcherRefreshes,
}));

describe("workspace disposal", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    updateConnectionStatus.mockReset();
    updateConnectionStatus.mockResolvedValue(undefined);
    closeTerminalConnection.mockReset();
    closeTerminalConnection.mockResolvedValue(undefined);
    cancelFileWatcherRefreshes.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cancels watcher work and closes every connected terminal", async () => {
    await disposeWorkspaceResources({
      workspaceId: "workspace:local",
      path: "/workspace",
      terminalConnections: [
        { connectionId: "terminal-1" },
        { connectionId: "terminal-2", remoteConnectionId: "remote-1" },
        {},
      ],
    });

    expect(cancelFileWatcherRefreshes).toHaveBeenCalledWith("workspace:local");
    expect(closeTerminalConnection).toHaveBeenCalledTimes(2);
    expect(closeTerminalConnection).toHaveBeenNthCalledWith(1, {
      connectionId: "terminal-1",
    });
    expect(closeTerminalConnection).toHaveBeenNthCalledWith(2, {
      connectionId: "terminal-2",
      remoteConnectionId: "remote-1",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(updateConnectionStatus).not.toHaveBeenCalled();
  });

  it("disconnects and marks a remote workspace connection offline", async () => {
    await disposeWorkspaceResources({
      workspaceId: "workspace:remote",
      path: "remote://connection-1/",
      terminalConnections: [],
    });

    expect(invoke).toHaveBeenCalledWith("ssh_disconnect_only", {
      connectionId: "connection-1",
    });
    expect(updateConnectionStatus).toHaveBeenCalledWith("connection-1", false);
  });

  it("continues remote cleanup when a terminal or disconnect request fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    closeTerminalConnection.mockRejectedValue(new Error("terminal close failed"));
    invoke.mockRejectedValue(new Error("disconnect failed"));

    await expect(
      disposeWorkspaceResources({
        workspaceId: "workspace:remote",
        path: "remote://connection-1/",
        terminalConnections: [{ connectionId: "terminal-1" }],
      }),
    ).resolves.toBeUndefined();

    expect(updateConnectionStatus).toHaveBeenCalledWith("connection-1", false);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});

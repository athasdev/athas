import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { saveAndConnectRemoteConnection } from "../services/remote-connection-actions";
import type { RemoteConnection } from "../types/remote.types";

const invoke = vi.hoisted(() => vi.fn());
const saveConnection = vi.hoisted(() => vi.fn());
const deleteConnection = vi.hoisted(() => vi.fn());
const updateConnectionStatus = vi.hoisted(() => vi.fn());
const handleOpenRemoteProject = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: {
    getState: () => ({ handleOpenRemoteProject }),
  },
}));
vi.mock("../stores/remote-connection.store", () => ({
  connectionStore: { deleteConnection, saveConnection, updateConnectionStatus },
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

const connection: RemoteConnection = {
  id: "remote-1",
  name: "Production",
  host: "production",
  port: 22,
  username: "",
  type: "ssh",
  isConnected: false,
};

describe("saveAndConnectRemoteConnection", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    saveConnection.mockReset();
    saveConnection.mockResolvedValue(undefined);
    deleteConnection.mockReset();
    deleteConnection.mockResolvedValue(undefined);
    updateConnectionStatus.mockReset();
    updateConnectionStatus.mockResolvedValue(undefined);
    handleOpenRemoteProject.mockReset();
    handleOpenRemoteProject.mockResolvedValue(true);
    toastSuccess.mockReset();
  });

  it("saves, connects, and opens the new remote workspace", async () => {
    await saveAndConnectRemoteConnection(connection);

    expect(saveConnection).toHaveBeenCalledWith(connection);
    expect(invoke).toHaveBeenCalledWith("ssh_connect", {
      connectionId: "remote-1",
      host: "production",
      port: 22,
      username: "",
      password: null,
      keyPath: null,
      useSftp: false,
    });
    expect(handleOpenRemoteProject).toHaveBeenCalledWith("remote-1", "Production");
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Connected to Production");
  });

  it("removes the saved entry when the SSH connection fails", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "ssh_connect") {
        return Promise.reject(new Error("Authentication failed"));
      }
      return Promise.resolve(undefined);
    });

    await expect(saveAndConnectRemoteConnection(connection)).rejects.toThrow(
      "Authentication failed",
    );

    expect(invoke).toHaveBeenCalledWith("ssh_disconnect_only", {
      connectionId: "remote-1",
    });
    expect(deleteConnection).toHaveBeenCalledWith("remote-1");
    expect(handleOpenRemoteProject).not.toHaveBeenCalled();
  });

  it("cleans up a partially saved entry when persistence fails", async () => {
    saveConnection.mockRejectedValue(new Error("Store unavailable"));

    await expect(saveAndConnectRemoteConnection(connection)).rejects.toThrow("Store unavailable");

    expect(invoke).toHaveBeenCalledWith("ssh_disconnect_only", {
      connectionId: "remote-1",
    });
    expect(deleteConnection).toHaveBeenCalledWith("remote-1");
    expect(handleOpenRemoteProject).not.toHaveBeenCalled();
  });

  it("cleans up when the workspace cannot be opened", async () => {
    handleOpenRemoteProject.mockResolvedValue(false);

    await expect(saveAndConnectRemoteConnection(connection)).rejects.toThrow(
      "Failed to open remote workspace.",
    );

    expect(invoke).toHaveBeenCalledWith("ssh_disconnect_only", {
      connectionId: "remote-1",
    });
    expect(deleteConnection).toHaveBeenCalledWith("remote-1");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

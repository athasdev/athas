import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ensureRemoteConnectionConnected,
  establishRemoteConnection,
} from "../services/remote-connection-client";
import type { RemoteConnection } from "../types/remote.types";

const invoke = vi.hoisted(() => vi.fn());
const getConnection = vi.hoisted(() => vi.fn());
const updateConnectionStatus = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../stores/remote-connection.store", () => ({
  connectionStore: { getConnection, updateConnectionStatus },
}));

const connection: RemoteConnection = {
  id: "remote-1",
  name: "Production",
  host: "example.com",
  port: 22,
  username: "developer",
  password: "stored-password",
  keyPath: "/keys/id_ed25519",
  type: "ssh",
  isConnected: false,
};

describe("remote connection client", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    getConnection.mockReset();
    updateConnectionStatus.mockReset();
    updateConnectionStatus.mockResolvedValue(undefined);
  });

  it("establishes a connection with an explicitly provided password", async () => {
    await establishRemoteConnection(connection, "prompt-password");

    expect(invoke).toHaveBeenCalledWith("ssh_connect", {
      connectionId: "remote-1",
      host: "example.com",
      port: 22,
      username: "developer",
      password: "prompt-password",
      keyPath: "/keys/id_ed25519",
      useSftp: false,
    });
    expect(updateConnectionStatus).toHaveBeenCalledWith("remote-1", true, expect.any(String));
  });

  it("returns an already connected record without reconnecting", async () => {
    const connected = { ...connection, isConnected: true };
    getConnection.mockResolvedValue(connected);

    await expect(ensureRemoteConnectionConnected("remote-1")).resolves.toBe(connected);
    expect(invoke).not.toHaveBeenCalled();
    expect(updateConnectionStatus).not.toHaveBeenCalled();
  });

  it("reconnects a stored disconnected record", async () => {
    getConnection.mockResolvedValue(connection);

    await expect(ensureRemoteConnectionConnected("remote-1")).resolves.toBe(connection);
    expect(invoke).toHaveBeenCalledWith(
      "ssh_connect",
      expect.objectContaining({
        connectionId: "remote-1",
        password: "stored-password",
      }),
    );
    expect(updateConnectionStatus).toHaveBeenCalledWith("remote-1", true, expect.any(String));
  });

  it("rejects an unknown saved connection", async () => {
    getConnection.mockResolvedValue(null);

    await expect(ensureRemoteConnectionConnected("missing")).rejects.toThrow(
      "Remote connection not found.",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { closeTerminalConnection } from "../services/terminal-connection-lifecycle";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("terminal connection lifecycle", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("does nothing when no backend connection exists", async () => {
    await closeTerminalConnection({});

    expect(invoke).not.toHaveBeenCalled();
  });

  it("closes a local terminal connection", async () => {
    await closeTerminalConnection({ connectionId: "terminal-1" });

    expect(invoke).toHaveBeenCalledWith("close_terminal", { id: "terminal-1" });
  });

  it("closes a remote terminal connection through the remote command", async () => {
    await closeTerminalConnection({
      connectionId: "terminal-2",
      remoteConnectionId: "remote-1",
    });

    expect(invoke).toHaveBeenCalledWith("close_remote_terminal", { id: "terminal-2" });
  });

  it("propagates backend errors to the caller", async () => {
    invoke.mockRejectedValue(new Error("close failed"));

    await expect(closeTerminalConnection({ connectionId: "terminal-1" })).rejects.toThrow(
      "close failed",
    );
  });
});

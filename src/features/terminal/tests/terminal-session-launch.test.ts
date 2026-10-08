import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { launchTerminalSession } from "../services/terminal-session-launch";
import { useTerminalStore } from "../stores/terminal.store";
import {
  releaseTerminalEventChannel,
  subscribeToTerminalEvents,
} from "../services/terminal-protocol";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class<T> {
    constructor(public onmessage: (message: T) => void) {}
  },
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function registered(workspaceId = "workspace-a") {
  const owner = useTerminalStore.getStore(workspaceId);
  owner.getState().actions.registerSession("session");
  return owner;
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("terminal session launch ownership", () => {
  it("skips native launch when the tab closes before its launch task starts", async () => {
    const owner = registered();
    const launch = vi.fn().mockResolvedValue("never-created");
    const result = launchTerminalSession({ owner, sessionId: "session", updates: {}, launch });
    owner.getState().actions.removeSession("session");
    await expect(result).resolves.toBeNull();
    expect(launch).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("allows a retry when the launch callback throws synchronously", async () => {
    const owner = registered();
    const launch = vi.fn(() => {
      throw new Error("Native setup unavailable");
    });
    const options = { owner, sessionId: "session", updates: {}, launch };
    await expect(launchTerminalSession(options)).rejects.toThrow("Native setup unavailable");
    await expect(launchTerminalSession(options)).rejects.toThrow("Native setup unavailable");
    expect(launch).toHaveBeenCalledTimes(2);
  });
  it("shares a pending launch across view remounts and retains early output", async () => {
    const owner = registered();
    const response = deferred<string>();
    const launch = vi.fn((events) => {
      events.channel.onmessage(new Uint8Array([65]).buffer);
      return response.promise;
    });
    const options = {
      owner,
      sessionId: "session",
      updates: { currentDirectory: "/project" },
      launch,
    };
    const first = launchTerminalSession(options);
    const remount = launchTerminalSession(options);
    expect(first).toBe(remount);
    await Promise.resolve();
    expect(launch).toHaveBeenCalledTimes(1);
    response.resolve("pty-1");
    await expect(first).resolves.toBe("pty-1");
    expect(owner.getState().actions.getSession("session")).toMatchObject({
      connectionId: "pty-1",
      currentDirectory: "/project",
    });
    const received = vi.fn();
    subscribeToTerminalEvents("pty-1", received);
    expect(received).toHaveBeenCalledExactlyOnceWith({
      event: "output",
      data: new Uint8Array([65]),
    });
    releaseTerminalEventChannel("pty-1");
  });

  it.each([undefined, "ssh-1"])(
    "closes a late %s connection without recreating a closed session",
    async (remoteConnectionId) => {
      const owner = registered();
      const response = deferred<string>();
      let signal: AbortSignal | undefined;
      const result = launchTerminalSession({
        owner,
        sessionId: "session",
        updates: { remoteConnectionId },
        launch: async (events, lifetime) => {
          signal = lifetime;
          events.channel.onmessage(new Uint8Array([65]).buffer);
          return response.promise;
        },
      });
      await Promise.resolve();
      owner.getState().actions.removeSession("session");
      expect(signal?.aborted).toBe(true);
      response.resolve("late-pty");
      await expect(result).resolves.toBeNull();
      expect(invoke).toHaveBeenCalledExactlyOnceWith(
        remoteConnectionId ? "close_remote_terminal" : "close_terminal",
        { id: "late-pty" },
      );
      expect(owner.getState().sessions.has("session")).toBe(false);
      const received = vi.fn();
      subscribeToTerminalEvents("late-pty", received);
      expect(received).not.toHaveBeenCalled();
    },
  );

  it("keeps an old reply from attaching to a reopened session or deleting its pending launch", async () => {
    const owner = registered();
    const old = deferred<string>();
    const replacement = deferred<string>();
    const options = { owner, sessionId: "session", updates: {} };
    const first = launchTerminalSession({ ...options, launch: () => old.promise });
    await Promise.resolve();
    owner.getState().actions.removeSession("session");
    owner.getState().actions.registerSession("session");
    const nextLaunch = vi.fn(() => replacement.promise);
    const next = launchTerminalSession({ ...options, launch: nextLaunch });
    old.resolve("old-pty");
    await expect(first).resolves.toBeNull();
    expect(launchTerminalSession({ ...options, launch: nextLaunch })).toBe(next);
    replacement.resolve("new-pty");
    await expect(next).resolves.toBe("new-pty");
    expect(owner.getState().actions.getSession("session")?.connectionId).toBe("new-pty");
    expect(nextLaunch).toHaveBeenCalledTimes(1);
    releaseTerminalEventChannel("new-pty");
  });

  it("retains the originating workspace when another workspace becomes active", async () => {
    const owner = registered();
    const response = deferred<string>();
    const first = launchTerminalSession({
      owner,
      sessionId: "session",
      updates: {},
      launch: () => response.promise,
    });
    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-b", name: "B" });
    const other = registered("workspace-b");
    other.getState().actions.updateSession("session", { connectionId: "other-pty" });
    response.resolve("original-pty");
    await expect(first).resolves.toBe("original-pty");
    expect(owner.getState().actions.getSession("session")?.connectionId).toBe("original-pty");
    expect(other.getState().actions.getSession("session")?.connectionId).toBe("other-pty");
    expect(invoke).not.toHaveBeenCalled();
    releaseTerminalEventChannel("original-pty");
  });

  it("cancels review when the owner workspace disappears and closes a reply for a removed store", async () => {
    const owner = registered();
    const response = deferred<string>();
    let signal: AbortSignal | undefined;
    const result = launchTerminalSession({
      owner,
      sessionId: "session",
      updates: {},
      launch: async (events, lifetime) => {
        signal = lifetime;
        events.channel.onmessage(new Uint8Array([65]).buffer);
        return response.promise;
      },
    });
    await Promise.resolve();
    workspaceRuntimeRegistry.removeWorkspace("workspace-a");
    expect(signal?.aborted).toBe(true);
    const reopened = registered();
    response.resolve("orphan-pty");
    await expect(result).resolves.toBeNull();
    expect(reopened.getState().actions.getSession("session")?.connectionId).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("close_terminal", { id: "orphan-pty" });
  });

  it("does not launch an absent session and reuses an existing native process", async () => {
    const owner = useTerminalStore.getStore("workspace-a");
    const launch = vi.fn();
    const options = { owner, sessionId: "session", updates: {}, launch };
    await expect(launchTerminalSession(options)).resolves.toBeNull();
    owner.getState().actions.registerSession("session", { connectionId: "existing" });
    await expect(launchTerminalSession(options)).resolves.toBe("existing");
    expect(launch).not.toHaveBeenCalled();
  });

  it("allows retry after a failed launch and exposes cleanup failures", async () => {
    const owner = registered();
    const options = { owner, sessionId: "session", updates: {} };
    await expect(
      launchTerminalSession({
        ...options,
        launch: async () => {
          throw new Error("Authentication failed");
        },
      }),
    ).rejects.toThrow("Authentication failed");
    const response = deferred<string>();
    const result = launchTerminalSession({ ...options, launch: () => response.promise });
    await Promise.resolve();
    owner.getState().actions.removeSession("session");
    invoke.mockRejectedValueOnce(new Error("Native cleanup failed"));
    response.resolve("late-pty");
    await expect(result).rejects.toThrow("Native cleanup failed");
    expect(owner.getState().sessions.has("session")).toBe(false);
  });
});

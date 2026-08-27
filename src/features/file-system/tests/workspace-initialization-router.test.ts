import { describe, expect, it, vi } from "vite-plus/test";
import {
  initializeWorkspacePath,
  resumeWorkspacePath,
  type WorkspaceInitializationHandlers,
  type WorkspaceResumeHandlers,
} from "../services/workspace-initialization-router";

function createHandlers() {
  return {
    initializeLocal: vi.fn(async () => true),
    initializeRemote: vi.fn(async () => true),
    initializeWsl: vi.fn(async () => true),
  } satisfies WorkspaceInitializationHandlers;
}

function createResumeHandlers() {
  return {
    resumeSession: vi.fn(),
    resumeLocalServices: vi.fn(),
    stopLocalServices: vi.fn(),
  } satisfies WorkspaceResumeHandlers;
}

describe("workspace initialization router", () => {
  it("routes local workspace paths to the local initializer", async () => {
    const handlers = createHandlers();

    await expect(initializeWorkspacePath("/workspace/athas", handlers)).resolves.toBe(true);

    expect(handlers.initializeLocal).toHaveBeenCalledWith("/workspace/athas");
    expect(handlers.initializeRemote).not.toHaveBeenCalled();
    expect(handlers.initializeWsl).not.toHaveBeenCalled();
  });

  it("routes SSH workspace paths by connection id", async () => {
    const handlers = createHandlers();

    await expect(
      initializeWorkspacePath("remote://connection-1/repository", handlers),
    ).resolves.toBe(true);

    expect(handlers.initializeRemote).toHaveBeenCalledWith("connection-1");
    expect(handlers.initializeLocal).not.toHaveBeenCalled();
    expect(handlers.initializeWsl).not.toHaveBeenCalled();
  });

  it("routes normalized WSL workspace paths by distro and Linux path", async () => {
    const handlers = createHandlers();

    await expect(initializeWorkspacePath("wsl://Ubuntu/home/me/../repo", handlers)).resolves.toBe(
      true,
    );

    expect(handlers.initializeWsl).toHaveBeenCalledWith("Ubuntu", "/home/repo");
    expect(handlers.initializeLocal).not.toHaveBeenCalled();
    expect(handlers.initializeRemote).not.toHaveBeenCalled();
  });

  it("preserves initializer failures", async () => {
    const handlers = createHandlers();
    handlers.initializeRemote.mockResolvedValue(false);

    await expect(initializeWorkspacePath("remote://offline/", handlers)).resolves.toBe(false);
  });
});

describe("workspace resume router", () => {
  it("resumes the session before local workspace services", () => {
    const handlers = createResumeHandlers();

    resumeWorkspacePath("/workspace/athas", handlers);

    expect(handlers.resumeSession).toHaveBeenCalledOnce();
    expect(handlers.resumeLocalServices).toHaveBeenCalledOnce();
    expect(handlers.stopLocalServices).not.toHaveBeenCalled();
    expect(handlers.resumeSession.mock.invocationCallOrder[0]).toBeLessThan(
      handlers.resumeLocalServices.mock.invocationCallOrder[0],
    );
  });

  it.each(["remote://connection-1/repository", "wsl://Ubuntu/home/repo"])(
    "stops stale local services when resuming %s",
    (path) => {
      const handlers = createResumeHandlers();

      resumeWorkspacePath(path, handlers);

      expect(handlers.resumeSession).toHaveBeenCalledOnce();
      expect(handlers.stopLocalServices).toHaveBeenCalledOnce();
      expect(handlers.resumeLocalServices).not.toHaveBeenCalled();
    },
  );
});

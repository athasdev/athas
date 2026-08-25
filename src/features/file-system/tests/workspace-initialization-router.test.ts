import { describe, expect, it, vi } from "vite-plus/test";
import {
  initializeWorkspacePath,
  type WorkspaceInitializationHandlers,
} from "../services/workspace-initialization-router";

function createHandlers() {
  return {
    initializeLocal: vi.fn(async () => true),
    initializeRemote: vi.fn(async () => true),
    initializeWsl: vi.fn(async () => true),
  } satisfies WorkspaceInitializationHandlers;
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

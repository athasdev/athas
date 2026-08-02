import { invoke } from "@tauri-apps/api/core";
import { readDir } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clearRepositoryDiscoveryCache,
  discoverWorkspaceRepositories,
  resolveRepositoryPath,
} from "../api/git-repo-api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockReadDir = vi.mocked(readDir);
const directoryEntry = (name: string) => ({
  name,
  isDirectory: true,
  isFile: false,
  isSymlink: false,
});

describe("git repo api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockReadDir.mockReset();
    clearRepositoryDiscoveryCache();
  });

  it("includes a parent repository when the workspace is opened from a subfolder", async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "git_discover_repo" && args && "path" in args) {
        return args.path === "/parent/project-one" ? "/parent" : null;
      }
      return null;
    });
    mockReadDir.mockResolvedValue([]);

    await expect(
      discoverWorkspaceRepositories("/parent/project-one", { force: true }),
    ).resolves.toEqual(["/parent"]);
  });

  it("keeps the containing repository first when nested repositories are found", async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "git_discover_repo" && args && "path" in args) {
        return args.path === "/parent/project-one" ? "/parent" : null;
      }
      return null;
    });
    mockReadDir.mockImplementation(async (path) => {
      if (path === "/parent/project-one") {
        return [directoryEntry("nested")];
      }
      if (path === "/parent/project-one/nested") {
        return [directoryEntry(".git")];
      }
      return [];
    });

    await expect(
      discoverWorkspaceRepositories("/parent/project-one", { force: true }),
    ).resolves.toEqual(["/parent", "/parent/project-one/nested"]);
  });

  it("does not let a cleared in-flight discovery overwrite the new cache", async () => {
    let resolveFirst: (value: string | null) => void = () => {};
    let resolveSecond: (value: string | null) => void = () => {};
    const first = new Promise<string | null>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<string | null>((resolve) => {
      resolveSecond = resolve;
    });
    mockInvoke.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const staleRequest = resolveRepositoryPath("/workspace");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
    clearRepositoryDiscoveryCache();
    const currentRequest = resolveRepositoryPath("/workspace");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));

    resolveSecond("/workspace");
    await expect(currentRequest).resolves.toBe("/workspace");
    resolveFirst(null);
    await expect(staleRequest).resolves.toBeNull();
    await expect(resolveRepositoryPath("/workspace")).resolves.toBe("/workspace");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("does not negative-cache transient native discovery failures", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("Native channel unavailable"))
      .mockResolvedValueOnce("/workspace");

    await expect(resolveRepositoryPath("/workspace")).rejects.toThrow("Native channel unavailable");
    await expect(resolveRepositoryPath("/workspace")).resolves.toBe("/workspace");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

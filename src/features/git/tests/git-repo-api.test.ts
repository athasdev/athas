import { invoke } from "@tauri-apps/api/core";
import { readDir } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clearRepositoryDiscoveryCache, discoverWorkspaceRepositories } from "../api/git-repo-api";

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
});

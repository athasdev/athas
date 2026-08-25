import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getWorkspaceResourceProvider,
  readWorkspaceDirectoryEntries,
} from "../services/workspace-resource-provider";

const invoke = vi.hoisted(() => vi.fn());
const readDirectoryContents = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../controllers/file-operations", () => ({ readDirectoryContents }));

describe("workspace resource provider", () => {
  beforeEach(() => {
    invoke.mockReset();
    readDirectoryContents.mockReset();
  });

  it("reads and sorts local directory entries through the local provider", async () => {
    readDirectoryContents.mockResolvedValue([
      { name: "zeta.ts", path: "/workspace/zeta.ts", isDir: false },
      { name: "alpha", path: "/workspace/alpha", isDir: true },
    ]);

    await expect(readWorkspaceDirectoryEntries("/workspace", "/workspace")).resolves.toEqual([
      { name: "alpha", path: "/workspace/alpha", isDir: true },
      { name: "zeta.ts", path: "/workspace/zeta.ts", isDir: false },
    ]);
    expect(getWorkspaceResourceProvider("/workspace").kind).toBe("local");
    expect(readDirectoryContents).toHaveBeenCalledWith("/workspace", "/workspace");
  });

  it("maps SSH directory entries to application paths", async () => {
    invoke.mockResolvedValue([
      { name: "src", path: "/repo/src", is_dir: true, size: 0 },
      { name: "README.md", path: "/repo/README.md", is_dir: false, size: 100 },
    ]);

    await expect(readWorkspaceDirectoryEntries("remote://connection-1/repo")).resolves.toEqual([
      {
        name: "src",
        path: "remote://connection-1/repo/src",
        isDir: true,
        children: [],
      },
      {
        name: "README.md",
        path: "remote://connection-1/repo/README.md",
        isDir: false,
        children: undefined,
      },
    ]);
    expect(getWorkspaceResourceProvider("remote://connection-1/repo").kind).toBe("remote");
    expect(invoke).toHaveBeenCalledWith("ssh_read_directory", {
      connectionId: "connection-1",
      path: "/repo",
    });
  });

  it("preserves WSL symlink metadata", async () => {
    invoke.mockResolvedValue([
      {
        name: "linked",
        path: "wsl://Ubuntu/home/me/linked",
        is_dir: false,
        size: 10,
        is_symlink: true,
        target: "/home/me/target",
      },
    ]);

    await expect(readWorkspaceDirectoryEntries("wsl://Ubuntu/home/me")).resolves.toEqual([
      {
        name: "linked",
        path: "wsl://Ubuntu/home/me/linked",
        isDir: false,
        children: undefined,
        isSymlink: true,
        symlinkTarget: "/home/me/target",
      },
    ]);
    expect(getWorkspaceResourceProvider("wsl://Ubuntu/home/me").kind).toBe("wsl");
    expect(invoke).toHaveBeenCalledWith("wsl_read_directory", {
      distro: "Ubuntu",
      path: "/home/me",
    });
  });
});

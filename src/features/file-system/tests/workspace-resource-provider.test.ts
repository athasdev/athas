import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getWorkspaceResourceProvider,
  readWorkspaceDirectoryEntries,
} from "../services/workspace-resource-provider";

const invoke = vi.hoisted(() => vi.fn());
const readDirectoryContents = vi.hoisted(() => vi.fn());
const readFileContent = vi.hoisted(() => vi.fn());
const readLocalFileBytes = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: readLocalFileBytes }));
vi.mock("../controllers/file-operations", () => ({ readDirectoryContents, readFileContent }));

describe("workspace resource provider", () => {
  beforeEach(() => {
    invoke.mockReset();
    readDirectoryContents.mockReset();
    readFileContent.mockReset();
    readLocalFileBytes.mockReset();
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

  it("reads local text and bytes through the existing filesystem adapters", async () => {
    readFileContent.mockResolvedValue("local text");
    readLocalFileBytes.mockResolvedValue(Uint8Array.from([108, 111, 99, 97, 108]));
    const provider = getWorkspaceResourceProvider("/workspace/readme.md");

    await expect(provider.readText("/workspace/readme.md")).resolves.toBe("local text");
    await expect(provider.readBytes("/workspace/readme.md")).resolves.toEqual(
      Uint8Array.from([108, 111, 99, 97, 108]),
    );
    expect(readFileContent).toHaveBeenCalledWith("/workspace/readme.md");
    expect(readLocalFileBytes).toHaveBeenCalledWith("/workspace/readme.md");
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

  it("reads SSH text without pretending byte inspection is supported", async () => {
    invoke.mockResolvedValue("remote text");
    const path = "remote://connection-1/repo/README.md";
    const provider = getWorkspaceResourceProvider(path);

    await expect(provider.readText(path)).resolves.toBe("remote text");
    await expect(provider.readBytes(path)).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("ssh_read_file", {
      connectionId: "connection-1",
      filePath: "/repo/README.md",
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

  it("reads WSL text and converts byte responses", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "wsl_read_file") {
        return Promise.resolve("WSL text");
      }
      if (command === "wsl_read_file_bytes") {
        return Promise.resolve([87, 83, 76]);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const path = "wsl://Ubuntu/home/me/readme.md";
    const provider = getWorkspaceResourceProvider(path);

    await expect(provider.readText(path)).resolves.toBe("WSL text");
    await expect(provider.readBytes(path)).resolves.toEqual(Uint8Array.from([87, 83, 76]));
    expect(invoke).toHaveBeenNthCalledWith(1, "wsl_read_file", {
      distro: "Ubuntu",
      filePath: "/home/me/readme.md",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "wsl_read_file_bytes", {
      distro: "Ubuntu",
      filePath: "/home/me/readme.md",
    });
  });
});

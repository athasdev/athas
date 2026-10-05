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

  it.each([
    [
      "remote://connection-1/repo/a.ts",
      "ssh_write_file",
      { connectionId: "connection-1", filePath: "/repo/a.ts", content: "updated" },
    ],
    [
      "wsl://Ubuntu/home/me/a.ts",
      "wsl_write_file",
      { distro: "Ubuntu", filePath: "/home/me/a.ts", content: "updated" },
    ],
  ])("writes %s through the correct backend", async (path, command, args) => {
    await getWorkspaceResourceProvider(path as string).writeText(path as string, "updated");
    expect(invoke).toHaveBeenCalledWith(command, args);
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
        return Promise.resolve(Uint8Array.of(87, 83, 76).buffer);
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
  it("sends expected local content to the native checked-write command", async () => {
    const provider = getWorkspaceResourceProvider("/workspace/a.ts");
    await provider.writeText("/workspace/a.ts", "after", "before");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("write_local_file_checked", {
      path: "/workspace/a.ts",
      content: "after",
      expectedContent: "before",
    });
    await provider.deleteText("/workspace/a.ts", "after");
    expect(invoke).toHaveBeenLastCalledWith("delete_local_file_checked", {
      path: "/workspace/a.ts",
      expectedContent: "after",
    });
  });

  it.each([
    [
      "remote://connection/repo/a.ts",
      "ssh_write_file_checked",
      "ssh_delete_file_checked",
      { connectionId: "connection", filePath: "/repo/a.ts" },
    ],
    [
      "wsl://Ubuntu/home/test/a.ts",
      "wsl_write_file_checked",
      "wsl_delete_file_checked",
      { distro: "Ubuntu", filePath: "/home/test/a.ts" },
    ],
  ])(
    "passes the expected text to the checked backend for %s",
    async (path, writeCommand, deleteCommand, args) => {
      const provider = getWorkspaceResourceProvider(path as string);
      await provider.writeText(path as string, "after", "before");
      expect(invoke).toHaveBeenCalledExactlyOnceWith(writeCommand, {
        ...(args as object),
        content: "after",
        expectedContent: "before",
      });
      await provider.deleteText(path as string, "after");
      expect(invoke).toHaveBeenLastCalledWith(deleteCommand, {
        ...(args as object),
        expectedContent: "after",
      });
      invoke.mockRejectedValueOnce(new Error("The file changed while preparing the update."));
      await expect(provider.writeText(path as string, "after", "before")).rejects.toThrow(
        "changed",
      );
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === "ssh_read_file" || command === "wsl_read_file",
        ),
      ).toHaveLength(0);
    },
  );

  it.each(["remote://connection/repo/a.ts", "wsl://Ubuntu/home/test/a.ts"])(
    "can request restoration of missing files on %s",
    async (path) => {
      await getWorkspaceResourceProvider(path).writeText(path, "restored", null);
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke.mock.calls[0][1]).toMatchObject({ content: "restored", expectedContent: null });
    },
  );

  it("preserves SSH symlink metadata for context exclusion checks", async () => {
    invoke.mockResolvedValue([
      {
        name: ".aiignore",
        path: "/repo/.aiignore",
        is_dir: false,
        size: 10,
        is_symlink: true,
        target: "/outside/policy",
      },
    ]);
    const entries = await readWorkspaceDirectoryEntries("remote://connection/repo");
    expect(entries[0]).toMatchObject({
      name: ".aiignore",
      isSymlink: true,
      symlinkTarget: "/outside/policy",
    });
  });
});

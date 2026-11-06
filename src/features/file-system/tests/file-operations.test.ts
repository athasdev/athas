import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const readDirectoryMock = vi.fn();
const getSymlinkInfoMock = vi.fn();
const { localPathExistsMock, writeFileMock } = vi.hoisted(() => ({
  localPathExistsMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("../api/file-system-api", () => ({
  createDirectory: vi.fn(),
  deletePath: vi.fn(),
  getSymlinkInfo: getSymlinkInfoMock,
  localPathExists: localPathExistsMock,
  readDirectory: readDirectoryMock,
  readFile: vi.fn(),
  writeFile: writeFileMock,
}));

vi.mock("../stores/file-system.store", () => ({
  useFileSystemStore: {
    getState: () => ({
      rootFolderPath: "/workspace",
    }),
  },
}));

describe("file operations", () => {
  beforeEach(() => {
    readDirectoryMock.mockReset();
    getSymlinkInfoMock.mockReset();
  });

  it("uses readDir symlink metadata instead of probing every entry", async () => {
    readDirectoryMock.mockResolvedValue([
      {
        name: "src",
        path: "/workspace/src",
        is_dir: true,
        is_symlink: false,
      },
      {
        name: "README.md",
        path: "/workspace/README.md",
        is_dir: false,
        is_symlink: false,
      },
      {
        name: "linked",
        path: "/workspace/linked",
        is_dir: false,
        is_symlink: true,
      },
    ]);
    getSymlinkInfoMock.mockResolvedValue({
      is_symlink: true,
      target: "../shared",
      is_dir: false,
    });

    const { readDirectoryContents } = await import("../api/file-operations");

    const entries = await readDirectoryContents("/workspace");

    expect(getSymlinkInfoMock).toHaveBeenCalledTimes(1);
    expect(getSymlinkInfoMock).toHaveBeenCalledWith("/workspace/linked", "/workspace");
    expect(entries).toEqual([
      {
        name: "src",
        path: "/workspace/src",
        isDir: true,
        children: undefined,
      },
      {
        name: "README.md",
        path: "/workspace/README.md",
        isDir: false,
        children: undefined,
      },
      {
        name: "linked",
        path: "/workspace/linked",
        isDir: false,
        children: undefined,
        isSymlink: true,
        symlinkTarget: "../shared",
      },
    ]);
  });

  it("never empties a file that already exists when creating one with its name", async () => {
    const { createNewFile } = await import("../api/file-operations");
    localPathExistsMock.mockResolvedValueOnce(true);

    await expect(createNewFile("/workspace/src", "index.ts")).rejects.toThrow(
      "index.ts already exists",
    );
    expect(writeFileMock).not.toHaveBeenCalled();

    localPathExistsMock.mockResolvedValueOnce(false);
    await expect(createNewFile("/workspace/src", "new.ts")).resolves.toBe("/workspace/src/new.ts");
    expect(writeFileMock).toHaveBeenCalledWith("/workspace/src/new.ts", "");
  });
});

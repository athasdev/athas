import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getWorkspaceEntryMutationProvider } from "../services/workspace-entry-mutation-provider";

const invoke = vi.hoisted(() => vi.fn());
const dirname = vi.hoisted(() => vi.fn());
const join = vi.hoisted(() => vi.fn());
const createNewDirectory = vi.hoisted(() => vi.fn());
const createNewFile = vi.hoisted(() => vi.fn());
const deleteFileOrDirectory = vi.hoisted(() => vi.fn());
const moveFile = vi.hoisted(() => vi.fn());
const renameFile = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/path", () => ({ dirname, join }));
vi.mock("../controllers/file-operations", () => ({
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
}));
vi.mock("../controllers/platform", () => ({ moveFile, renameFile }));

describe("workspace entry mutation provider", () => {
  beforeEach(() => {
    invoke.mockReset();
    createNewDirectory.mockReset();
    createNewFile.mockReset();
    deleteFileOrDirectory.mockReset();
    dirname.mockReset();
    join.mockReset();
    moveFile.mockReset();
    renameFile.mockReset();
  });

  it("routes local mutations through the platform file operations", async () => {
    createNewFile.mockResolvedValue("/workspace/new.ts");
    createNewDirectory.mockResolvedValue("/workspace/src");
    const provider = getWorkspaceEntryMutationProvider("/workspace");

    await expect(provider.createFile("/workspace", "new.ts")).resolves.toBe("/workspace/new.ts");
    await expect(provider.createDirectory("/workspace", "src")).resolves.toBe("/workspace/src");
    await provider.deletePath("/workspace/old.ts", false);

    expect(provider.kind).toBe("local");
    expect(createNewFile).toHaveBeenCalledWith("/workspace", "new.ts");
    expect(createNewDirectory).toHaveBeenCalledWith("/workspace", "src");
    expect(deleteFileOrDirectory).toHaveBeenCalledWith("/workspace/old.ts");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps WSL mutations on the existing platform adapter", async () => {
    createNewFile.mockResolvedValue("wsl://Ubuntu/home/me/repo/new.ts");
    const path = "wsl://Ubuntu/home/me/repo";
    const provider = getWorkspaceEntryMutationProvider(path);

    await expect(provider.createFile(path, "new.ts")).resolves.toBe(
      "wsl://Ubuntu/home/me/repo/new.ts",
    );

    expect(provider.kind).toBe("wsl");
    expect(createNewFile).toHaveBeenCalledWith(path, "new.ts");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("creates SSH files and directories with application and remote paths", async () => {
    const provider = getWorkspaceEntryMutationProvider("remote://connection-1/repo");

    await expect(provider.createFile("remote://connection-1/repo", "new.ts")).resolves.toBe(
      "remote://connection-1/repo/new.ts",
    );
    await expect(provider.createDirectory("remote://connection-1/", "src")).resolves.toBe(
      "remote://connection-1/src",
    );

    expect(provider.kind).toBe("remote");
    expect(invoke).toHaveBeenNthCalledWith(1, "ssh_create_file", {
      connectionId: "connection-1",
      filePath: "/repo/new.ts",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "ssh_create_directory", {
      connectionId: "connection-1",
      directoryPath: "/src",
    });
  });

  it("preserves the SSH entry type when deleting a path", async () => {
    const provider = getWorkspaceEntryMutationProvider("remote://connection-1/repo/src");

    await provider.deletePath("remote://connection-1/repo/src", true);

    expect(invoke).toHaveBeenCalledWith("ssh_delete_path", {
      connectionId: "connection-1",
      targetPath: "/repo/src",
      isDirectory: true,
    });
  });

  it("renames local paths through the platform adapter", async () => {
    dirname.mockResolvedValue("/workspace/src");
    join.mockResolvedValue("/workspace/src/renamed.ts");
    const provider = getWorkspaceEntryMutationProvider("/workspace/src/original.ts");

    await expect(provider.renamePath("/workspace/src/original.ts", "renamed.ts")).resolves.toBe(
      "/workspace/src/renamed.ts",
    );

    expect(renameFile).toHaveBeenCalledWith(
      "/workspace/src/original.ts",
      "/workspace/src/renamed.ts",
    );
  });

  it("renames WSL paths without leaking Linux paths to the store", async () => {
    const provider = getWorkspaceEntryMutationProvider("wsl://Ubuntu/home/me/original.ts");

    await expect(
      provider.renamePath("wsl://Ubuntu/home/me/original.ts", "renamed.ts"),
    ).resolves.toBe("wsl://Ubuntu/home/me/renamed.ts");

    expect(renameFile).toHaveBeenCalledWith(
      "wsl://Ubuntu/home/me/original.ts",
      "wsl://Ubuntu/home/me/renamed.ts",
    );
  });

  it("renames SSH paths with separate application and backend targets", async () => {
    const provider = getWorkspaceEntryMutationProvider(
      "remote://connection-1/repo/src/original.ts",
    );

    await expect(
      provider.renamePath("remote://connection-1/repo/src/original.ts", "renamed.ts"),
    ).resolves.toBe("remote://connection-1/repo/src/renamed.ts");

    expect(invoke).toHaveBeenCalledWith("ssh_rename_path", {
      connectionId: "connection-1",
      sourcePath: "/repo/src/original.ts",
      targetPath: "/repo/src/renamed.ts",
    });
    expect(renameFile).not.toHaveBeenCalled();
  });

  it("moves local paths through the platform adapter", async () => {
    const provider = getWorkspaceEntryMutationProvider("/workspace/src/original.ts");

    await provider.movePath("/workspace/src/original.ts", "/workspace/lib/original.ts");

    expect(moveFile).toHaveBeenCalledWith(
      "/workspace/src/original.ts",
      "/workspace/lib/original.ts",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("moves WSL paths through the platform adapter", async () => {
    const provider = getWorkspaceEntryMutationProvider("wsl://Ubuntu/home/me/src/original.ts");

    await provider.movePath(
      "wsl://Ubuntu/home/me/src/original.ts",
      "wsl://Ubuntu/home/me/lib/original.ts",
    );

    expect(moveFile).toHaveBeenCalledWith(
      "wsl://Ubuntu/home/me/src/original.ts",
      "wsl://Ubuntu/home/me/lib/original.ts",
    );
  });

  it("moves SSH paths through one remote backend call", async () => {
    const provider = getWorkspaceEntryMutationProvider(
      "remote://connection-1/repo/src/original.ts",
    );

    await provider.movePath(
      "remote://connection-1/repo/src/original.ts",
      "remote://connection-1/repo/lib/original.ts",
    );

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("ssh_rename_path", {
      connectionId: "connection-1",
      sourcePath: "/repo/src/original.ts",
      targetPath: "/repo/lib/original.ts",
    });
    expect(moveFile).not.toHaveBeenCalled();
  });

  it("rejects moves across workspace backends", async () => {
    await expect(
      getWorkspaceEntryMutationProvider("/workspace/original.ts").movePath(
        "/workspace/original.ts",
        "remote://connection-1/repo/original.ts",
      ),
    ).rejects.toThrow("between local and remote workspaces");
    await expect(
      getWorkspaceEntryMutationProvider("remote://connection-1/repo/original.ts").movePath(
        "remote://connection-1/repo/original.ts",
        "remote://connection-2/repo/original.ts",
      ),
    ).rejects.toThrow("between SSH connections or local folders");

    expect(moveFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getWorkspaceEntryMutationProvider } from "../services/workspace-entry-mutation-provider";

const invoke = vi.hoisted(() => vi.fn());
const createNewDirectory = vi.hoisted(() => vi.fn());
const createNewFile = vi.hoisted(() => vi.fn());
const deleteFileOrDirectory = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../controllers/file-operations", () => ({
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
}));

describe("workspace entry mutation provider", () => {
  beforeEach(() => {
    invoke.mockReset();
    createNewDirectory.mockReset();
    createNewFile.mockReset();
    deleteFileOrDirectory.mockReset();
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
});

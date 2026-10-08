import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { writeFile } from "../api/file-system-api";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), invalidate: vi.fn(), writeTextFile: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 0 },
  mkdir: vi.fn(),
  readFile: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
  writeTextFile: mocks.writeTextFile,
}));
vi.mock("@/features/file-explorer/services/file-tree-gitignore", () => ({
  invalidateFileTreeGitIgnoreCache: mocks.invalidate,
}));

describe("platform text writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockReset().mockResolvedValue(undefined);
  });

  it("routes ordinary local writes through the same native mutation coordinator as agent writes", async () => {
    await writeFile("/workspace/.gitignore", "dist/\n");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("write_local_file", {
      path: "/workspace/.gitignore",
      content: "dist/\n",
    });
    expect(mocks.invalidate).toHaveBeenCalledWith("/workspace/.gitignore");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("propagates native failures without retrying through an unguarded filesystem adapter", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("The file is read-only."));
    await expect(writeFile("/workspace/readonly.txt", "changed")).rejects.toThrow("read-only");
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("keeps WSL text writes on their own backend", async () => {
    await writeFile("wsl://Ubuntu/home/me/a.ts", "updated");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("wsl_write_file", {
      distro: "Ubuntu",
      filePath: "/home/me/a.ts",
      content: "updated",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { readDirectory } from "../api/file-system-api";
const io = vi.hoisted(() => ({ readDir: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 0 },
  mkdir: vi.fn(),
  readFile: vi.fn(),
  readDir: io.readDir,
  remove: vi.fn(),
}));
beforeEach(() => {
  io.invoke.mockReset();
  io.readDir
    .mockReset()
    .mockResolvedValue([{ name: "a.ts", isDirectory: false, isSymlink: false }]);
});
describe("directory paths", () => {
  it.each([
    ["/", "/", "/a.ts"],
    ["///", "/", "/a.ts"],
    ["C:\\", "C:\\", "C:\\a.ts"],
    ["C:/", "C:/", "C:/a.ts"],
    ["\\", "\\", "\\a.ts"],
    ["/workspace/", "/workspace", "/workspace/a.ts"],
    ["/workspace/a\\b\\", "/workspace/a\\b\\", "/workspace/a\\b\\/a.ts"],
    ["\\\\server\\share\\", "\\\\server\\share", "\\\\server\\share\\a.ts"],
  ])(
    "preserves the directory %j and returns an absolute child",
    async (path, expectedRoot, expectedChild) => {
      const entries = await readDirectory(path);
      expect(io.readDir).toHaveBeenCalledWith(expectedRoot);
      expect(entries[0]?.path).toBe(expectedChild);
    },
  );
  it("rejects an empty path without reading another directory", async () => {
    await expect(readDirectory("")).rejects.toThrow("directory path is required");
    expect(io.readDir).not.toHaveBeenCalled();
  });
  it("keeps WSL root reads on their backend", async () => {
    io.invoke.mockResolvedValue([
      { name: "a.ts", path: "wsl://Ubuntu/a.ts", is_dir: false, is_symlink: false },
    ]);
    const entries = await readDirectory("wsl://Ubuntu/");
    expect(io.invoke).toHaveBeenCalledWith("wsl_read_directory", { distro: "Ubuntu", path: "/" });
    expect(entries[0]?.path).toBe("wsl://Ubuntu/a.ts");
    expect(io.readDir).not.toHaveBeenCalled();
  });
});

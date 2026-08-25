import { describe, expect, it, vi } from "vite-plus/test";
import { resolveFileOpenPath, shouldResolveFileOpenSymlink } from "../controllers/file-open-path";

const symlinkEntry = {
  name: "linked",
  path: "/workspace/linked",
  isDir: false,
  isSymlink: true,
};

describe("file open path resolution", () => {
  it("skips non-symlinks and virtual paths", async () => {
    const readSymlinkInfo = vi.fn();

    expect(shouldResolveFileOpenSymlink("/workspace/file.ts", undefined)).toBe(false);
    expect(shouldResolveFileOpenSymlink("diff://staged/file.ts", symlinkEntry)).toBe(false);
    expect(shouldResolveFileOpenSymlink("remote://connection/repo/file.ts", symlinkEntry)).toBe(
      false,
    );
    await expect(
      resolveFileOpenPath("/workspace/file.ts", undefined, "/workspace", readSymlinkInfo),
    ).resolves.toBe("/workspace/file.ts");
    expect(readSymlinkInfo).not.toHaveBeenCalled();
  });

  it("resolves a stored WSL symlink target without another native lookup", async () => {
    const readSymlinkInfo = vi.fn();
    const entry = {
      ...symlinkEntry,
      path: "wsl://Ubuntu/home/me/repo/linked.ts",
      symlinkTarget: "../shared/file.ts",
    };

    await expect(
      resolveFileOpenPath(entry.path, entry, "wsl://Ubuntu/home/me/repo", readSymlinkInfo),
    ).resolves.toBe("wsl://Ubuntu/home/me/shared/file.ts");
    expect(readSymlinkInfo).not.toHaveBeenCalled();
  });

  it("uses native symlink metadata when the tree has no cached target", async () => {
    const readSymlinkInfo = vi.fn().mockResolvedValue({
      is_symlink: true,
      target: "shared/file.ts",
      is_dir: false,
    });

    await expect(
      resolveFileOpenPath("/workspace/linked.ts", symlinkEntry, "/workspace", readSymlinkInfo),
    ).resolves.toBe("/workspace/shared/file.ts");
    expect(readSymlinkInfo).toHaveBeenCalledWith("/workspace/linked.ts", "/workspace");
  });

  it("preserves absolute symlink targets", async () => {
    const entry = { ...symlinkEntry, symlinkTarget: "/shared/file.ts" };

    await expect(resolveFileOpenPath(entry.path, entry, "/workspace")).resolves.toBe(
      "/shared/file.ts",
    );
  });
});

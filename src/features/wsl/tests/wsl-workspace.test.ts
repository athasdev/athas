import { describe, expect, it } from "vite-plus/test";
import { buildWslWorkspaceTree, getWslProjectName } from "../controllers/wsl-workspace";

describe("buildWslWorkspaceTree", () => {
  it("wraps WSL directory entries in a WSL workspace root", () => {
    expect(
      buildWslWorkspaceTree("Ubuntu", "/home/me/project", [
        {
          name: "src",
          path: "wsl://Ubuntu/home/me/project/src",
          is_dir: true,
          size: 0,
          is_symlink: false,
        },
        {
          name: "README.md",
          path: "wsl://Ubuntu/home/me/project/README.md",
          is_dir: false,
          size: 42,
          is_symlink: false,
        },
      ]),
    ).toEqual({
      wslPath: "wsl://Ubuntu/home/me/project",
      fileTree: [
        {
          name: "src",
          path: "wsl://Ubuntu/home/me/project/src",
          isDir: true,
          children: [],
          isSymlink: false,
          symlinkTarget: undefined,
        },
        {
          name: "README.md",
          path: "wsl://Ubuntu/home/me/project/README.md",
          isDir: false,
          children: undefined,
          isSymlink: false,
          symlinkTarget: undefined,
        },
      ],
      wrappedFileTree: [
        {
          name: "project (Ubuntu)",
          path: "wsl://Ubuntu/home/me/project",
          isDir: true,
          children: [
            {
              name: "src",
              path: "wsl://Ubuntu/home/me/project/src",
              isDir: true,
              children: [],
              isSymlink: false,
              symlinkTarget: undefined,
            },
            {
              name: "README.md",
              path: "wsl://Ubuntu/home/me/project/README.md",
              isDir: false,
              children: undefined,
              isSymlink: false,
              symlinkTarget: undefined,
            },
          ],
        },
      ],
    });
  });

  it("uses distro name for root projects", () => {
    expect(getWslProjectName("Ubuntu", "/")).toBe("Ubuntu");
  });
});

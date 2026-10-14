import { describe, expect, it } from "vite-plus/test";
import { getRelativePath } from "@/utils/path-helpers";
import { buildRemoteWorkspaceTree } from "../controllers/remote-workspace";

describe("buildRemoteWorkspaceTree", () => {
  it("wraps remote directory entries in a remote workspace root", () => {
    expect(
      buildRemoteWorkspaceTree("conn-1", "Production", [
        { name: "src", path: "/src", is_dir: true, size: 0 },
        { name: "README.md", path: "/README.md", is_dir: false, size: 42 },
      ]),
    ).toEqual({
      remotePath: "remote://conn-1/",
      fileTree: [
        {
          name: "src",
          path: "remote://conn-1/src",
          isDir: true,
          children: [],
        },
        {
          name: "README.md",
          path: "remote://conn-1/README.md",
          isDir: false,
          children: undefined,
        },
      ],
      wrappedFileTree: [
        {
          name: "Production",
          path: "remote://conn-1/",
          isDir: true,
          children: [
            {
              name: "src",
              path: "remote://conn-1/src",
              isDir: true,
              children: [],
            },
            {
              name: "README.md",
              path: "remote://conn-1/README.md",
              isDir: false,
              children: undefined,
            },
          ],
        },
      ],
    });
  });

  it("keeps entries listed from the remote root under the workspace root", () => {
    const { fileTree } = buildRemoteWorkspaceTree("conn-1", "Production", [
      { name: "bin", path: "//bin", is_dir: true, size: 0 },
    ]);

    expect(fileTree[0].path).toBe("remote://conn-1/bin");
    expect(getRelativePath(fileTree[0].path, "remote://conn-1/")).toBe("bin");
  });
});

import { describe, expect, it } from "vite-plus/test";
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
});

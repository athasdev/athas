import { describe, expect, it } from "vite-plus/test";
import { openDroppedWorkspacePaths } from "../utils/open-dropped-workspace-paths";

describe("openDroppedWorkspacePaths", () => {
  it("opens every dropped folder and continues to files", async () => {
    const openedFolders: string[] = [];
    const openedFiles: string[] = [];

    const result = await openDroppedWorkspacePaths(
      ["/workspace/one", "/workspace/two", "/workspace/two/file.ts"],
      {
        getPathInfo: async (path) => ({ is_dir: !path.endsWith(".ts") }),
        openFolder: async (path) => {
          openedFolders.push(path);
          return true;
        },
        openFile: async (path) => {
          openedFiles.push(path);
          return true;
        },
      },
    );

    expect(openedFolders).toEqual(["/workspace/one", "/workspace/two"]);
    expect(openedFiles).toEqual(["/workspace/two/file.ts"]);
    expect(result).toEqual({
      openedFolderCount: 2,
      openedFileCount: 1,
      failedPathCount: 0,
    });
  });

  it("continues after a failed dropped path", async () => {
    const failedPaths: string[] = [];
    const openedFiles: string[] = [];

    const result = await openDroppedWorkspacePaths(["/missing", "/workspace/file.ts"], {
      getPathInfo: async (path) => {
        if (path === "/missing") {
          throw new Error("missing");
        }
        return { is_dir: false };
      },
      openFile: async (path) => {
        openedFiles.push(path);
        return true;
      },
      onError: (path) => {
        failedPaths.push(path);
      },
    });

    expect(failedPaths).toEqual(["/missing"]);
    expect(openedFiles).toEqual(["/workspace/file.ts"]);
    expect(result).toEqual({
      openedFolderCount: 0,
      openedFileCount: 1,
      failedPathCount: 1,
    });
  });
});

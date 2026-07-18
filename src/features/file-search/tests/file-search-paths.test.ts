import { describe, expect, it } from "vite-plus/test";
import { getNativeWorkspaceRootPaths } from "../utils/file-search-paths";

describe("getNativeWorkspaceRootPaths", () => {
  it("keeps unique local workspace roots in their configured order", () => {
    expect(
      getNativeWorkspaceRootPaths("/workspace", [
        { path: "/workspace" },
        { path: "/shared" },
        { path: "/shared" },
      ]),
    ).toEqual(["/workspace", "/shared"]);
  });

  it("excludes virtual provider roots", () => {
    expect(
      getNativeWorkspaceRootPaths("wsl://Ubuntu/workspace", [
        "remote://host/project",
        "diff://change",
      ]),
    ).toEqual([]);
  });
});

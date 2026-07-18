import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getGitBlame } from "../api/git-blame-api";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("git blame api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    clearRepositoryDiscoveryCache();
  });

  it("blames the current editor content against the resolved repository file", async () => {
    const blame = { file_path: "src/app.ts", lines: [] };
    mockInvoke.mockImplementation((command) => {
      if (command === "git_discover_repo") return Promise.resolve("/workspace");
      if (command === "git_blame_file") return Promise.resolve(blame);
      return Promise.resolve(null);
    });

    await expect(
      getGitBlame("/workspace", "/workspace/src/app.ts", "const changed = true;\n"),
    ).resolves.toEqual(blame);
    expect(mockInvoke).toHaveBeenCalledWith("git_blame_file", {
      rootPath: "/workspace",
      filePath: "src/app.ts",
      content: "const changed = true;\n",
    });
  });
});

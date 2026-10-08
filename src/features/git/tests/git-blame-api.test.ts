import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getGitBlame, prewarmGitBlame } from "../api/git-blame-api";
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
    const commit = {
      hash: "abc123",
      author: "Ada",
      email: "ada@example.com",
      time: 1_700_000_000,
      message: "Add app",
    };
    const payload = {
      file_path: "src/app.ts",
      commits: [commit],
      hunks: [
        { line_number: 1, total_lines: 1, commit_index: null },
        { line_number: 2, total_lines: 3, commit_index: 0 },
      ],
    };
    mockInvoke.mockImplementation((command) => {
      if (command === "git_discover_repo") return Promise.resolve("/workspace");
      if (command === "git_blame_file") return Promise.resolve(payload);
      return Promise.resolve(null);
    });

    await expect(
      getGitBlame("/workspace", "/workspace/src/app.ts", "const changed = true;\n"),
    ).resolves.toEqual({
      file_path: "src/app.ts",
      lines: [
        {
          line_number: 1,
          total_lines: 1,
          commit_hash: "",
          is_uncommitted: true,
          author: "",
          email: "",
          time: 0,
          commit: "",
        },
        {
          line_number: 2,
          total_lines: 3,
          commit_hash: "abc123",
          is_uncommitted: false,
          author: "Ada",
          email: "ada@example.com",
          time: 1_700_000_000,
          commit: "Add app",
        },
      ],
    });
    expect(mockInvoke).toHaveBeenCalledWith("git_blame_file", {
      rootPath: "/workspace",
      filePath: "src/app.ts",
      content: "const changed = true;\n",
    });
  });

  it("prewarms files grouped by their repository and skips files outside one", async () => {
    mockInvoke.mockImplementation((command, args) => {
      if (command === "git_discover_repo") {
        const path = (args as { path: string }).path;
        if (path.startsWith("/workspace/vendor/lib"))
          return Promise.resolve("/workspace/vendor/lib");
        if (path.startsWith("/workspace")) return Promise.resolve("/workspace");
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    await prewarmGitBlame("/workspace", [
      "/workspace/src/app.ts",
      "/workspace/vendor/lib/index.ts",
      "/elsewhere/notes.md",
      "/workspace/src/util.ts",
    ]);

    const prewarms = mockInvoke.mock.calls.filter(([command]) => command === "git_prewarm_blame");
    expect(prewarms.map(([, args]) => args)).toEqual([
      { rootPath: "/workspace", filePaths: ["src/app.ts", "src/util.ts"] },
      { rootPath: "/workspace/vendor/lib", filePaths: ["index.ts"] },
    ]);
  });
});

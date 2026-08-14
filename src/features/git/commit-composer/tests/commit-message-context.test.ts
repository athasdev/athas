import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getGitLog } from "../../api/git-commits-api";
import { getFileDiff } from "../../api/git-diff-api";
import type { GitDiff, GitFile } from "../../types/git.types";
import {
  buildCommitMessageContext,
  normalizeGeneratedCommitMessage,
} from "../utils/commit-message-context";

vi.mock("../../api/git-commits-api", () => ({ getGitLog: vi.fn() }));
vi.mock("../../api/git-diff-api", () => ({ getFileDiff: vi.fn() }));

const stagedFile: GitFile = {
  path: "src/example.ts",
  status: "modified",
  staged: true,
};

const stagedDiff: GitDiff = {
  file_path: stagedFile.path,
  is_new: false,
  is_deleted: false,
  is_renamed: false,
  lines: [
    { line_type: "removed", content: "const oldValue = true;" },
    { line_type: "added", content: "const newValue = true;" },
  ],
};

describe("commit message context", () => {
  beforeEach(() => {
    vi.mocked(getGitLog).mockResolvedValue([
      {
        hash: "abc123",
        message: "Keep commit messages direct",
        author: "Athas",
        date: "2026-08-14T12:00:00.000Z",
      },
    ]);
    vi.mocked(getFileDiff).mockResolvedValue(stagedDiff);
  });

  it("includes repository style, staged files, and sampled diff content", async () => {
    const context = await buildCommitMessageContext({
      repoPath: "/workspace/athas",
      currentBranch: "main",
      stagedFiles: [stagedFile],
      existingDraftHint: "Draft subject",
    });

    expect(context).toContain("Repository: athas");
    expect(context).toContain("Branch: main");
    expect(context).toContain("- Keep commit messages direct");
    expect(context).toContain("- modified staged: src/example.ts");
    expect(context).toContain("Staged diff summary for sampled files: +1 -1");
    expect(context).toContain("+const newValue = true;");
    expect(context).toContain("Current draft:\nDraft subject");
  });

  it("keeps only the first line in title mode", () => {
    expect(
      normalizeGeneratedCommitMessage("```text\nImprove commits\nExtra detail\n```", "title"),
    ).toBe("Improve commits");
  });

  it("preserves a useful body in body mode", () => {
    expect(normalizeGeneratedCommitMessage("Improve commits\n\nExplain why.", "body")).toBe(
      "Improve commits\n\nExplain why.",
    );
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { GitCommitFilesPanel } from "../components/git-commit-files-panel";
import type { GitCommit, GitDiff } from "../types/git.types";

const commit: GitCommit = {
  hash: "4fbe6911234567890",
  message: "Improve commit navigation",
  description: "Keep commit details in the sidebar and leave the editor focused on the diff.",
  author: "Athas",
  date: "2026-08-11T12:00:00.000Z",
};

const files: GitDiff[] = [
  {
    file_path: "src/features/git-view.tsx",
    new_path: "src/features/git-view.tsx",
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    additions: 8,
    deletions: 2,
    lines: [],
  },
];

describe("GitCommitFilesPanel", () => {
  it("shows a top-level back action and the selected commit files", () => {
    const markup = renderToStaticMarkup(
      <GitCommitFilesPanel
        commit={commit}
        files={files}
        selectedFilePath="src/features/git-view.tsx"
        isLoading={false}
        onBack={vi.fn()}
        onSelectFile={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Back to Source Control history"');
    expect(markup).toContain("4fbe691");
    expect(markup).toContain("Improve commit navigation");
    expect(markup).toContain("Keep commit details in the sidebar");
    expect(markup).toContain('aria-label="Athas"');
    expect(markup).toContain("1 changed file");
    expect(markup).toContain("git-view.tsx");
    expect(markup).toContain("+8");
    expect(markup).toContain("-2");
    expect(markup).toContain('aria-current="true"');
  });
});

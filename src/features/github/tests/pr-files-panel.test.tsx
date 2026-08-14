import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { PRFilesPanel } from "../components/pr-files-panel";

vi.mock("@/extensions/icon-themes/components/themed-file-icon", () => ({
  ThemedFileIcon: () => null,
}));

const files = [
  {
    path: "src/first.ts",
    additions: 2,
    deletions: 0,
    status: "modified" as const,
  },
  {
    path: "src/second.ts",
    additions: 1,
    deletions: 3,
    status: "modified" as const,
  },
];

describe("PRFilesPanel", () => {
  it("keeps the changed-files sidebar and floating progress on the same file", () => {
    const markup = renderToStaticMarkup(
      <PRFilesPanel
        selectedPRDiff="diff"
        isLoadingContent={false}
        contentError={null}
        diffFiles={files}
        selectedDiffFile={null}
        selectedFilePath="src/second.ts"
        isActive
        onRetry={vi.fn()}
        onSelectFile={vi.fn()}
        onOpenChangedFile={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Changed files"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("File 2 of 2");
    expect(markup).not.toContain('data-slot="diff-file-navigation-file"');
  });
});

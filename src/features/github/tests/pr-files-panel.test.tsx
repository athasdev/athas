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
  it("stacks every changed file in one multibuffer with shared navigation", () => {
    const markup = renderToStaticMarkup(
      <PRFilesPanel
        selectedPRDiff="diff"
        isLoadingContent={false}
        contentError={null}
        diffFiles={files}
        selectedFilePath="src/second.ts"
        onRetry={vi.fn()}
        onSelectFile={vi.fn()}
        onOpenChangedFile={vi.fn()}
      />,
    );

    expect(markup).toContain('data-slot="multibuffer-workspace"');
    expect(markup).toContain('data-multibuffer-section="src/first.ts"');
    expect(markup).toContain('data-multibuffer-section="src/second.ts"');
    expect(markup).toContain("data-multibuffer-navigator-toggle");
  });
});

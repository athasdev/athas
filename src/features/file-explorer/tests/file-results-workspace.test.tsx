import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { FileResultsWorkspace } from "../components/file-results-workspace";

const items = [{ key: "src/file.ts", path: "src/file.ts" }];

function renderWorkspace({
  showNavigator = true,
  navigatorPosition = "left",
}: {
  showNavigator?: boolean;
  navigatorPosition?: "left" | "right";
} = {}) {
  return renderToStaticMarkup(
    <FileResultsWorkspace
      items={items}
      selectedKey={items[0]?.key ?? null}
      onSelect={vi.fn()}
      ariaLabel="Result files"
      viewMode="tree"
      onViewModeChange={vi.fn()}
      showNavigator={showNavigator}
      navigatorPosition={navigatorPosition}
    >
      <main>Result content</main>
    </FileResultsWorkspace>,
  );
}

describe("FileResultsWorkspace", () => {
  it("can omit the file navigator without removing result content", () => {
    const markup = renderWorkspace({ showNavigator: false });

    expect(markup).not.toContain('aria-label="Result files"');
    expect(markup).toContain("Result content");
  });

  it("places an optional right navigator after result content", () => {
    const markup = renderWorkspace({ navigatorPosition: "right" });
    const resultIndex = markup.indexOf("Result content");
    const navigatorIndex = markup.indexOf('aria-label="Result files"');

    expect(resultIndex).toBeGreaterThan(-1);
    expect(navigatorIndex).toBeGreaterThan(resultIndex);
  });
});

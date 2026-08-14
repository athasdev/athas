import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { GitHubViewerShell } from "../components/github-viewer-shell";

describe("GitHubViewerShell", () => {
  it("owns scrolling for detail content", () => {
    const markup = renderToStaticMarkup(
      <GitHubViewerShell header={<div>Header</div>}>Content</GitHubViewerShell>,
    );

    expect(markup).toContain('data-github-viewer-scroll-mode="content"');
    expect(markup).toContain('data-slot="scroll-area"');
  });

  it("delegates scrolling to an embedded workspace", () => {
    const markup = renderToStaticMarkup(
      <GitHubViewerShell header={<div>Header</div>} scrollMode="workspace">
        Workspace
      </GitHubViewerShell>,
    );

    expect(markup).toContain('data-github-viewer-scroll-mode="workspace"');
    expect(markup).not.toContain('data-slot="scroll-area"');
  });
});

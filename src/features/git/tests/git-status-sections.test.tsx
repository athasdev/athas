import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import GitStatusPanel from "../components/status/git-status-panel";
import type { GitFile } from "../types/git.types";

const file = (path: string, status: GitFile["status"]): GitFile => ({
  path,
  status,
  staged: false,
});

describe("Git status sections", () => {
  it("renders tracked and untracked sections expanded with a filter and view toggles", () => {
    const markup = renderToStaticMarkup(
      <GitStatusPanel
        files={[file("src/app.ts", "modified"), file("src/new-file.ts", "untracked")]}
      />,
    );

    expect(markup).toContain("Tracked");
    expect(markup).toContain("Untracked");
    expect(markup).toContain("app.ts");
    expect(markup).toContain("new-file.ts");
    expect(markup).toContain('aria-label="Change actions"');
    expect(markup.match(/data-slot="git-status-section"/g)).toHaveLength(2);
    expect(markup.match(/aria-expanded="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(markup).toContain('aria-label="Filter changed files"');
    expect(markup).toContain('aria-label="Flat list"');
    expect(markup).toContain('aria-label="File tree"');
  });
});

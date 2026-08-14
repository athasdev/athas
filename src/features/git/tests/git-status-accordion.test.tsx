import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import GitStatusPanel from "../components/status/git-status-panel";
import type { GitFile } from "../types/git.types";

const file = (path: string, status: GitFile["status"]): GitFile => ({
  path,
  status,
  staged: false,
});

describe("Git status accordions", () => {
  it("renders tracked and untracked sections expanded", () => {
    const markup = renderToStaticMarkup(
      <GitStatusPanel
        files={[file("src/app.ts", "modified"), file("src/new-file.ts", "untracked")]}
      />,
    );

    expect(markup).toContain("Tracked");
    expect(markup).toContain("Untracked");
    expect(markup).toContain("app.ts");
    expect(markup).toContain("new-file.ts");
    expect(markup.match(/data-slot="accordion-trigger"/g)).toHaveLength(2);
  });
});

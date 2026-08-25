import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import GitCommitHistory from "../components/git-commit-history";

describe("Git commit history layout", () => {
  it("keeps sync status inside the shared sidebar content inset", () => {
    const markup = renderToStaticMarkup(
      <GitCommitHistory ahead={1} searchQuery="" searchScope="all" />,
    );
    const contentIndex = markup.indexOf('data-slot="scroll-area-content"');
    const syncStatusIndex = markup.indexOf('data-slot="git-history-sync-status"');

    expect(contentIndex).toBeGreaterThan(-1);
    expect(syncStatusIndex).toBeGreaterThan(contentIndex);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GitRemoteManager from "../components/git-remote-manager";
import { GitStashManager } from "../components/git-stash-manager";
import GitTagManager from "../components/git-tag-manager";

describe("Git sidebar managers", () => {
  it("keeps remote creation inside the sidebar footer", () => {
    const markup = renderToStaticMarkup(<GitRemoteManager query="" />);

    expect(markup).toContain("Add remote");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("data-command-footer");
  });

  it("keeps tag creation inside the sidebar footer", () => {
    const markup = renderToStaticMarkup(<GitTagManager query="" />);

    expect(markup).toContain("Add tag");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("data-command-footer");
  });

  it("renders stash navigation and actions as a sidebar row", () => {
    const markup = renderToStaticMarkup(
      <GitStashManager
        stashes={[
          { index: 0, message: "WIP on main: 1234567 Improve navigation", date: "2026-09-05" },
        ]}
        query=""
        isActionLoading={() => false}
        onView={vi.fn()}
        onApply={vi.fn()}
        onPop={vi.fn()}
        onDrop={vi.fn()}
      />,
    );

    expect(markup).toContain("Improve navigation");
    expect(markup).toContain("Latest");
    expect(markup).toContain('data-slot="sidebar-list-item"');
    expect(markup).toContain("Actions for Improve navigation");
  });
});

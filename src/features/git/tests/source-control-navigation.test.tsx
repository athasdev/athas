import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceControlNavigation } from "../components/source-control-navigation";

describe("SourceControlNavigation", () => {
  it("owns Source Control sections inside the secondary sidebar", () => {
    const markup = renderToStaticMarkup(
      <SourceControlNavigation
        activeSection="changes"
        sectionOrder={["changes", "history", "review"]}
        hiddenItemIds={["tags"]}
        changeCount={4}
        commitCount={12}
        onSectionChange={() => {}}
        onOpenRemotes={() => {}}
        onOpenTags={() => {}}
        onOpenStashes={() => {}}
        onItemVisibleChange={() => {}}
      />,
    );

    expect(markup).toContain('data-slot="secondary-sidebar-navigation"');
    expect(markup).toContain('aria-label="Source Control sections"');
    expect(markup).toContain('aria-label="Source Control: Changes"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Source Control: Remotes"');
    expect(markup).toContain('aria-label="Source Control: Stashes"');
    expect(markup).not.toContain('aria-label="Source Control: Tags"');
  });
});

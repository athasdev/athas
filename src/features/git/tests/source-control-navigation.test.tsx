import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceControlNavigation } from "../components/source-control-navigation";

describe("SourceControlNavigation", () => {
  it("routes all six entries to sidebar sections", () => {
    const onSectionChange = vi.fn();
    const navigation = SourceControlNavigation({
      activeSection: "changes",
      sectionOrder: ["changes", "history", "review"],
      hiddenItemIds: [],
      changeCount: 4,
      commitCount: 12,
      onSectionChange,
    });
    const { items, onChange } = navigation.props;
    expect(items.map((item: { id: string }) => item.id)).toEqual([
      "changes",
      "history",
      "review",
      "remotes",
      "tags",
      "stashes",
    ]);
    items.forEach((item: { id: string }) => onChange(item.id));
    expect(onSectionChange.mock.calls).toEqual([
      ["changes"],
      ["history"],
      ["review"],
      ["remotes"],
      ["tags"],
      ["stashes"],
    ]);
  });

  it("preserves the configured order and hidden sections", () => {
    const navigation = SourceControlNavigation({
      activeSection: "review",
      sectionOrder: ["review", "changes", "history"],
      hiddenItemIds: ["history", "tags"],
      changeCount: 4,
      commitCount: 12,
      onSectionChange: vi.fn(),
    });
    expect(navigation.props.items.map((item: { id: string }) => item.id)).toEqual([
      "review",
      "changes",
      "remotes",
      "stashes",
    ]);
    expect(navigation.props.value).toBe("review");
  });

  it("owns Source Control sections inside the secondary sidebar", () => {
    const markup = renderToStaticMarkup(
      <SourceControlNavigation
        activeSection="changes"
        sectionOrder={["changes", "history", "review"]}
        hiddenItemIds={["tags"]}
        changeCount={4}
        commitCount={12}
        onSectionChange={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Source Control sections"');
    expect(markup).toContain('aria-label="Source Control: Changes"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-label="Source Control: Remotes"');
    expect(markup).toContain('aria-label="Source Control: Stashes"');
    expect(markup).not.toContain('aria-label="Source Control: Tags"');
    expect(markup).not.toContain("Choose visible Source Control items");
  });
});

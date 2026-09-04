import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceControlNavigation } from "../components/source-control-navigation";

describe("SourceControlNavigation", () => {
  it("routes all six entries and reserves Review for the sidebar", () => {
    const onSectionChange = vi.fn();
    const onOpenRemotes = vi.fn();
    const onOpenTags = vi.fn();
    const onOpenStashes = vi.fn();
    const navigation = SourceControlNavigation({
      activeSection: "changes",
      sectionOrder: ["changes", "history", "review"],
      hiddenItemIds: [],
      changeCount: 4,
      commitCount: 12,
      onSectionChange,
      onOpenRemotes,
      onOpenTags,
      onOpenStashes,
      onItemVisibleChange: vi.fn(),
    });
    const buttons = navigation.props.children[0].map(
      (item: {
        props: { children: { props: { onClick: () => void; "aria-haspopup"?: string } } };
      }) => item.props.children.props,
    );
    expect(buttons).toHaveLength(6);
    buttons.forEach((button: { onClick: () => void }) => button.onClick());
    expect(onSectionChange.mock.calls).toEqual([["changes"], ["history"], ["review"]]);
    expect(onOpenRemotes).toHaveBeenCalledOnce();
    expect(onOpenTags).toHaveBeenCalledOnce();
    expect(onOpenStashes).toHaveBeenCalledOnce();
    expect(buttons[2]["aria-haspopup"]).toBeUndefined();
    expect(
      buttons.filter(
        (button: { "aria-haspopup"?: string }) => button["aria-haspopup"] === "dialog",
      ),
    ).toHaveLength(5);
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
        onOpenRemotes={() => {}}
        onOpenTags={() => {}}
        onOpenStashes={() => {}}
        onItemVisibleChange={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Source Control sections"');
    expect(markup).toContain('aria-label="Source Control: Changes"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Source Control: Remotes"');
    expect(markup).toContain('aria-label="Source Control: Stashes"');
    expect(markup).not.toContain('aria-label="Source Control: Tags"');
  });
});

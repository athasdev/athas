import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarIconButton, SidebarListActionRow, SidebarListItem } from "@/ui/sidebar";

function renderRow() {
  return renderToStaticMarkup(
    <SidebarListActionRow
      actions={[
        <SidebarIconButton key="pin" aria-label="Pin">
          <span>pin</span>
        </SidebarIconButton>,
        <SidebarIconButton key="archive" tone="danger" aria-label="Archive">
          <span>archive</span>
        </SidebarIconButton>,
      ]}
    >
      <SidebarListItem>Improve React Docs</SidebarListItem>
    </SidebarListActionRow>,
  );
}

describe("sidebar list action row", () => {
  it("keeps the row a single full-width item instead of reserving an actions column", () => {
    const markup = renderRow();

    expect(markup).not.toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(markup).toContain('data-slot="sidebar-list-action-row"');
    expect(markup).toContain('data-slot="sidebar-list-actions"');
  });

  it("overlays the actions so they never shrink the label", () => {
    const markup = renderRow();
    const actionsClass = /data-slot="sidebar-list-actions" class="([^"]+)"/.exec(markup)?.[1] ?? "";

    expect(actionsClass).toContain("absolute");
    expect(actionsClass).toContain("opacity-0");
    expect(actionsClass).toContain("group-hover/sidebar-list-action-row:opacity-100");
  });

  it("renders the actions as a separated button group", () => {
    const markup = renderRow();

    expect(markup).toContain('data-slot="button-group"');
    expect(markup).toContain('data-slot="button-group-separator"');
    expect(markup).toContain('aria-label="Pin"');
    expect(markup).toContain('aria-label="Archive"');
  });
});

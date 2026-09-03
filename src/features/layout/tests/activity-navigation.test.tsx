import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityRailNavigation,
  ActivitySidebarNavigation,
} from "../components/sidebar/activity-navigation";
import type { ActivityNavigationItem } from "../hooks/use-activity-navigation-items";

const items: ActivityNavigationItem[] = [
  {
    id: "files",
    label: "Files",
    icon: <span>icon</span>,
    active: true,
    onClick: () => {},
    ariaLabel: "Files",
  },
];

const sourceControlItems: ActivityNavigationItem[] = [
  {
    id: "git",
    label: "Source Control",
    icon: <span>git icon</span>,
    active: true,
    onClick: () => {},
    ariaLabel: "Git Source Control",
  },
];

describe("activity navigation", () => {
  it("uses an icon-only navigation contract in the collapsed rail", () => {
    const markup = renderToStaticMarkup(<ActivityRailNavigation items={items} />);

    expect(markup).toContain('data-slot="activity-rail-navigation"');
    expect(markup).toContain('aria-label="Files"');
    expect(markup).toContain('data-slot="button"');
    expect(markup).not.toContain('data-slot="sidebar-list-item"');
  });

  it("keeps labels visible in the expanded activity sidebar", () => {
    const markup = renderToStaticMarkup(<ActivitySidebarNavigation items={items} />);

    expect(markup).toContain('data-slot="activity-sidebar-navigation"');
    expect(markup).toContain(">Files</span>");
    expect(markup).toContain('data-slot="sidebar-list-item"');
  });

  it("keeps secondary view sections out of the activity sidebar", () => {
    const markup = renderToStaticMarkup(<ActivitySidebarNavigation items={sourceControlItems} />);

    expect(markup).toContain(">Source Control</span>");
    expect(markup).not.toContain('data-slot="activity-sidebar-subnavigation"');
    expect(markup).not.toContain(">Changes</span>");
  });
});

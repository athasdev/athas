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

const dockerItems: ActivityNavigationItem[] = [
  {
    id: "docker",
    label: "Docker",
    icon: <span>docker icon</span>,
    active: true,
    onClick: () => {},
    ariaLabel: "Docker",
    submenuItems: [
      {
        id: "resources",
        label: "Resources",
        active: true,
        onClick: () => {},
      },
      {
        id: "compose",
        label: "Compose",
        onClick: () => {},
      },
    ],
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
    submenuItems: [
      { id: "changes", label: "Changes", onClick: () => {} },
      { id: "worktrees", label: "Worktrees", onClick: () => {} },
    ],
    hiddenSubmenuItemIds: ["worktrees"],
    onSubmenuItemVisibleChange: () => {},
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

  it("shows the active view sections inline in the expanded sidebar", () => {
    const markup = renderToStaticMarkup(<ActivitySidebarNavigation items={dockerItems} />);

    expect(markup).toContain('data-slot="activity-sidebar-subnavigation"');
    expect(markup).toContain('aria-label="Docker sections"');
    expect(markup).toContain(">Resources</span>");
    expect(markup).toContain(">Compose</span>");
    expect(markup).toContain('aria-label="Docker: Resources"');
    expect(markup).toContain('aria-current="page"');
  });

  it("hides inline sections when their parent view is inactive", () => {
    const inactiveDockerItems = dockerItems.map((item) => ({ ...item, active: false }));
    const markup = renderToStaticMarkup(<ActivitySidebarNavigation items={inactiveDockerItems} />);

    expect(markup).not.toContain('data-slot="activity-sidebar-subnavigation"');
    expect(markup).not.toContain(">Resources</span>");
  });

  it("shows submenu visibility controls and hides deselected rows", () => {
    const markup = renderToStaticMarkup(<ActivitySidebarNavigation items={sourceControlItems} />);

    expect(markup).toContain('aria-label="More actions for Source Control"');
    expect(markup).toContain(">Changes</span>");
    expect(markup).not.toContain(">Worktrees</span>");
  });
});

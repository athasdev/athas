import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityRailNavigation } from "../components/sidebar/activity-navigation";
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

describe("activity navigation", () => {
  it("moves secondary views into More while retaining primary navigation", () => {
    const secondary = ["views", "debugger", "databases", "workspaces", "docker"].map((id) => ({
      id,
      label: id,
      icon: <span>icon</span>,
      active: id === "docker",
      onClick: () => {},
      ariaLabel: id,
    }));
    const markup = renderToStaticMarkup(
      <ActivityRailNavigation items={[...items, ...secondary]} />,
    );
    expect(markup).toContain('aria-label="Files"');
    expect(markup).toContain('aria-label="More views: docker"');
    expect(markup).toContain('aria-haspopup="menu"');
    for (const item of secondary) expect(markup).not.toContain(`aria-label="${item.id}"`);
  });

  it("renders icon-only buttons without labels", () => {
    const markup = renderToStaticMarkup(<ActivityRailNavigation items={items} />);

    expect(markup).toContain('data-slot="activity-rail-navigation"');
    expect(markup).toContain('aria-label="Files"');
    expect(markup).toContain('data-slot="button"');
    expect(markup).not.toContain('data-slot="sidebar-list-item"');
  });

  it("puts the agents item after version control, in its own group", () => {
    const markup = renderToStaticMarkup(
      <ActivityRailNavigation
        items={[
          ...items,
          {
            id: "github-prs",
            label: "Pull Requests",
            icon: <span>github icon</span>,
            active: false,
            onClick: () => {},
            ariaLabel: "Pull Requests",
          },
          {
            id: "agents",
            label: "Agents",
            icon: <span>agents icon</span>,
            active: false,
            onClick: () => {},
            ariaLabel: "Agents",
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Agents"');
    expect(markup.indexOf('aria-label="Agents"')).toBeGreaterThan(
      markup.indexOf('aria-label="Pull Requests"'),
    );
    expect(markup.indexOf('aria-label="Pull Requests"')).toBeGreaterThan(
      markup.indexOf('aria-label="Files"'),
    );
  });
});

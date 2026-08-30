import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const titleBarSource = readFileSync(
  fileURLToPath(new URL("../components/title-bar/title-bar.tsx", import.meta.url)),
  "utf8",
);
const activityBarSource = readFileSync(
  fileURLToPath(new URL("../../layout/components/sidebar/activity-bar.tsx", import.meta.url)),
  "utf8",
);
const projectSwitcherSource = readFileSync(
  fileURLToPath(new URL("../../layout/components/project-switcher.tsx", import.meta.url)),
  "utf8",
);

describe("title bar controls", () => {
  it("places project and branch selectors after the activity sidebar toggle", () => {
    const sidebarToggleIndex = titleBarSource.indexOf("{sidebarToggle}");
    const projectSwitcherIndex = titleBarSource.indexOf("{workspaceSelectors}");
    const branchSelectorIndex = titleBarSource.indexOf("<GitBranchManager");

    expect(sidebarToggleIndex).toBeGreaterThan(-1);
    expect(projectSwitcherIndex).toBeGreaterThan(sidebarToggleIndex);
    expect(branchSelectorIndex).toBeGreaterThan(-1);
    expect(titleBarSource).toContain('triggerMode="branch"');
    expect(titleBarSource).toContain('aria-hidden="true"');
    expect(projectSwitcherSource).toContain(
      "<ProjectGlyph projectPath={projectPath} iconPath={displayIconPath} />",
    );
  });

  it("orders update, run, notifications, and account actions on the trailing side", () => {
    const updateIndex = titleBarSource.indexOf("<AppUpdateControl");
    const runActionsIndex = titleBarSource.indexOf("<RunActionsButton");
    const notificationsIndex = titleBarSource.indexOf("<NotificationsTrigger");
    const accountIndex = titleBarSource.indexOf("<AccountMenu");

    expect(updateIndex).toBeGreaterThan(-1);
    expect(runActionsIndex).toBeGreaterThan(updateIndex);
    expect(notificationsIndex).toBeGreaterThan(runActionsIndex);
    expect(accountIndex).toBeGreaterThan(notificationsIndex);
  });

  it("removes the relocated controls from the activity sidebar", () => {
    expect(activityBarSource).toContain('id: "search"');
    expect(activityBarSource).toContain("<MagnifyingGlassIcon />");
    expect(activityBarSource).toContain(
      'visibleNavigationItems.findIndex((item) => item.id === "files")',
    );
    expect(activityBarSource).not.toContain("<ProjectSwitcher");
    expect(activityBarSource).not.toContain("<NotificationsTrigger");
    expect(activityBarSource).not.toContain("<AppUpdateControl");
    expect(activityBarSource).not.toContain("<RunActionsButton");
    expect(activityBarSource).not.toContain("<AccountMenu");
  });

  it("aligns macOS controls with the native traffic lights", () => {
    expect(titleBarSource).toContain('isFullscreen ? undefined : "-translate-y-0.5"');
  });
});

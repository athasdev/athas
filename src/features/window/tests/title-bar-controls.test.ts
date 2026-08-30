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
const branchManagerSource = readFileSync(
  fileURLToPath(new URL("../../git/components/git-branch-manager.tsx", import.meta.url)),
  "utf8",
);
const dropdownSource = readFileSync(
  fileURLToPath(new URL("../../../ui/dropdown.tsx", import.meta.url)),
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

  it("keeps macOS control alignment stable across fullscreen transitions", () => {
    expect(titleBarSource).toContain('isFullscreen ? "pl-2" : "pl-title-bar-leading"');
    expect(titleBarSource).not.toContain("macTitleBarControlAlignment");
    expect(titleBarSource).not.toContain("translate-y");
  });
  it("uses searchable anchored menus for title bar project and branch selection", () => {
    expect(projectSwitcherSource).toContain("<DropdownMenuSearch");
    expect(projectSwitcherSource).toContain('placeholder="Search projects"');
    expect(projectSwitcherSource).toContain('viewport="searchable"');
    expect(branchManagerSource).toContain('if (triggerMode === "branch")');
    expect(branchManagerSource).toContain('placeholder="Search branches"');
    expect(branchManagerSource).toContain('viewport="searchable"');
    expect(branchManagerSource).toContain("<BranchDropdownActions");
    expect(branchManagerSource).toContain("New branch…");
    expect(dropdownSource).toContain('searchable: "max-h-80 scrollbar-gutter-stable"');
    expect(dropdownSource).toContain(
      'containerClassName={cn("sticky top-0 z-20 bg-surface/98", containerClassName)}',
    );
    expect(dropdownSource).toContain('openOnHover={appearance === "item"}');
  });
});

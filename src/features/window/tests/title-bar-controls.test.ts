import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const titleBarSource = readFileSync(
  fileURLToPath(new URL("../components/title-bar/title-bar.tsx", import.meta.url)),
  "utf8",
);
const titleNavigationSource = readFileSync(
  fileURLToPath(new URL("../components/title-bar/title-navigation.tsx", import.meta.url)),
  "utf8",
);
const accountMenuSource = readFileSync(
  fileURLToPath(new URL("../components/account-menu.tsx", import.meta.url)),
  "utf8",
);
const activityBarSource = readFileSync(
  fileURLToPath(new URL("../../layout/components/sidebar/activity-bar.tsx", import.meta.url)),
  "utf8",
);
const activityChromeSource = readFileSync(
  fileURLToPath(new URL("../../layout/components/sidebar/activity-chrome.tsx", import.meta.url)),
  "utf8",
);
const mainLayoutSource = readFileSync(
  fileURLToPath(new URL("../../layout/components/main-layout.tsx", import.meta.url)),
  "utf8",
);
const mainPaneTabBarSource = readFileSync(
  fileURLToPath(new URL("../../panes/components/main-pane-tab-bar.tsx", import.meta.url)),
  "utf8",
);
const paneContainerSource = readFileSync(
  fileURLToPath(new URL("../../panes/components/pane-container.tsx", import.meta.url)),
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
  it("places the icon-only project switcher in the activity rail", () => {
    const projectSwitcherIndex = activityChromeSource.indexOf("<ProjectSwitcher");

    expect(projectSwitcherIndex).toBeGreaterThan(-1);
    expect(activityChromeSource).not.toContain("<GitBranchManager");
    expect(projectSwitcherSource).toContain("iconOnly");
    expect(mainLayoutSource).toContain("<TitleBarWithSettings showMinimal overlay />");
    expect(projectSwitcherSource).toContain(
      "<ProjectGlyph\n                  projectPath={projectPath}",
    );
    expect(projectSwitcherSource).toContain('size="lg"');
  });

  it("keeps title navigation before tabs without an activity bar toggle", () => {
    expect(titleNavigationSource).not.toContain("<Toggle");
    expect(titleNavigationSource).not.toContain("toggleActivitySidebar");
    expect(mainLayoutSource).toContain("<TitleNavigation />");
    expect(mainLayoutSource.indexOf("<TitleNavigation")).toBeLessThan(
      mainLayoutSource.indexOf('data-slot="main-title-tab-bar"'),
    );
    expect(activityChromeSource).not.toContain("<Toggle");
  });

  it("orders update, run, notifications, and account actions in the activity footer", () => {
    const updateIndex = activityChromeSource.indexOf("<AppUpdateControl");
    const runActionsIndex = activityChromeSource.indexOf("<RunActionsButton");
    const notificationsIndex = activityChromeSource.indexOf("<NotificationsTrigger");
    const accountIndex = activityChromeSource.indexOf("<AccountMenu");

    expect(updateIndex).toBeGreaterThan(-1);
    expect(runActionsIndex).toBeGreaterThan(updateIndex);
    expect(notificationsIndex).toBeGreaterThan(runActionsIndex);
    expect(accountIndex).toBeGreaterThan(notificationsIndex);
    expect(activityChromeSource).toContain("<AccountMenu />");
    expect(accountMenuSource).toContain("<SidebarIconButton");
    expect(accountMenuSource).not.toContain("<SidebarListItem");
    expect(accountMenuSource).toContain('<DropdownMenuContent side="top"');
  });

  it("keeps activity navigation and the relocated chrome in the rail", () => {
    expect(activityBarSource).toContain('id: "search"');
    expect(activityBarSource).toContain("<SearchIcon />");
    expect(activityBarSource).toContain(
      'visibleNavigationItems.findIndex((item) => item.id === "files")',
    );
    expect(activityBarSource).toContain("<ActivityChrome />");
    expect(activityBarSource).toContain("<ActivityChromeFooter />");
    expect(activityBarSource).not.toContain("expanded");
  });

  it("keeps native window controls over the workbench", () => {
    expect(titleBarSource).toContain("pointer-events-none absolute top-0 right-0 w-auto");
    expect(
      mainLayoutSource.indexOf("<TitleBarWithSettings showMinimal overlay />"),
    ).toBeGreaterThan(mainLayoutSource.indexOf("<ActivityBar"));
  });

  it("mounts top pane tabs in a separate header above the main content", () => {
    const titleRowIndex = mainLayoutSource.indexOf('data-slot="workbench-title-row"');
    const headerIndex = mainLayoutSource.indexOf('data-slot="main-title-tab-bar"');
    const workbenchIndex = mainLayoutSource.indexOf('className="athas-workbench-glass');
    const contentIndex = mainLayoutSource.indexOf("ref={setMainContentRoot}");

    expect(titleRowIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeGreaterThan(titleRowIndex);
    expect(workbenchIndex).toBeGreaterThan(headerIndex);
    expect(contentIndex).toBeGreaterThan(workbenchIndex);
    expect(mainLayoutSource).toContain("<MainTabBarHostContext.Provider value={mainTabBarHost}>");
    expect(paneContainerSource).toContain("<MainPaneTabBar");
    expect(mainPaneTabBarSource).toContain("createPortal(");
    expect(mainPaneTabBarSource).toContain("host.header");
  });

  it("uses searchable anchored menus for activity sidebar project and branch selection", () => {
    expect(projectSwitcherSource).toContain("<DropdownMenuSearch");
    expect(projectSwitcherSource).toContain("<DropdownMenuViewport>");
    expect(projectSwitcherSource).toContain("<DropdownMenuFooter>");
    expect(projectSwitcherSource).toContain('placeholder="Search projects"');
    expect(projectSwitcherSource).toContain('viewport="searchable"');
    expect(branchManagerSource).toContain('if (triggerMode === "branch")');
    expect(branchManagerSource).toContain('placeholder="Search branches"');
    expect(branchManagerSource).toContain('viewport="searchable"');
    expect(branchManagerSource).toContain("<DropdownMenuViewport>");
    expect(branchManagerSource).toContain("<DropdownMenuFooter>");
    expect(branchManagerSource).toContain("<BranchDropdownActions");
    expect(branchManagerSource).toContain("New branch…");
    expect(dropdownSource).toContain(
      'className="sticky top-0 z-20 shrink-0 overflow-clip border-border border-b bg-overlay p-1"',
    );
    expect(dropdownSource).toContain('data-slot="dropdown-menu-viewport"');
    expect(dropdownSource).toContain('data-slot="dropdown-menu-footer"');
    expect(dropdownSource).toContain("openOnHover");
    expect(dropdownSource).toContain("has-data-popup-open:opacity-100");
    expect(dropdownSource).toContain("onMouseMove={(event) => event.stopPropagation()}");
  });
});

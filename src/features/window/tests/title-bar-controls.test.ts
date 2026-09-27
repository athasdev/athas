import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const titleBarSource = readFileSync(
  fileURLToPath(new URL("../components/title-bar/title-bar.tsx", import.meta.url)),
  "utf8",
);
const tabHistoryNavigationSource = readFileSync(
  fileURLToPath(new URL("../../tabs/components/tab-history-navigation.tsx", import.meta.url)),
  "utf8",
);
const tabBarSource = readFileSync(
  fileURLToPath(new URL("../../tabs/components/tab-bar.tsx", import.meta.url)),
  "utf8",
);
const titleLeadingSource = readFileSync(
  fileURLToPath(new URL("../components/title-bar/title-leading.tsx", import.meta.url)),
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
  it("leads the title bar with the sidebar toggle, then project and branch", () => {
    const toggleIndex = titleLeadingSource.indexOf("<Toggle");
    const projectIndex = titleLeadingSource.indexOf("<ProjectSwitcher");
    const branchIndex = titleLeadingSource.indexOf("<GitBranchManager");

    expect(toggleIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeGreaterThan(toggleIndex);
    expect(branchIndex).toBeGreaterThan(projectIndex);
    expect(titleLeadingSource).toContain('commandId="workbench.toggleSidebar"');
    expect(titleLeadingSource).toContain('triggerMode="branch"');
    expect(activityChromeSource).not.toContain("<ProjectSwitcher");
    expect(activityChromeSource).not.toContain("<GitBranchManager");
    expect(projectSwitcherSource).toContain(
      '<span className="min-w-0 truncate">{projectName}</span>',
    );
  });

  it("puts back and forward in the pane tab bar, right before the tabs", () => {
    expect(tabHistoryNavigationSource).toContain("export function TabHistoryNavigation");
    expect(mainLayoutSource).not.toContain("titleActions=");
    const navigationIndex = tabBarSource.indexOf("<TabHistoryNavigation />");
    expect(navigationIndex).toBeGreaterThan(-1);
    expect(navigationIndex).toBeLessThan(tabBarSource.indexOf("<SortableContext"));
  });

  it("orders update, run, notifications, and account actions in the activity footer", () => {
    const updateIndex = activityChromeSource.indexOf("<AppUpdateControl");
    const terminalIndex = activityChromeSource.indexOf("<TerminalToggle />");
    const runActionsIndex = activityChromeSource.indexOf("<RunActionsButton");
    const notificationsIndex = activityChromeSource.indexOf("<NotificationsTrigger");
    const accountIndex = activityChromeSource.indexOf("<AccountMenu");

    expect(updateIndex).toBeGreaterThan(-1);
    expect(terminalIndex).toBeGreaterThan(updateIndex);
    expect(runActionsIndex).toBeGreaterThan(terminalIndex);
    expect(notificationsIndex).toBeGreaterThan(runActionsIndex);
    expect(accountIndex).toBeGreaterThan(notificationsIndex);
    expect(activityChromeSource).toContain("<AccountMenu />");
    expect(accountMenuSource).toContain("<SidebarIconButton");
    expect(accountMenuSource).not.toContain("<SidebarListItem");
    // The rail's overlay placement opens the account menu to the right.
    expect(accountMenuSource).toContain('<DropdownMenuContent size="wide">');
    expect(activityBarSource).toContain('<OverlaySideProvider side="right" align="end">');
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
    expect(mainLayoutSource.indexOf("<TitleBarWithSettings showMinimal overlay")).toBeGreaterThan(
      mainLayoutSource.indexOf("<ActivityBar"),
    );
  });

  it("keeps pane tabs inside the main view instead of the title bar", () => {
    expect(mainLayoutSource).toContain('data-slot="workbench-title-row"');
    expect(mainLayoutSource).not.toContain("main-title-tab-bar");
    expect(paneContainerSource).toContain("<TabBar");
    expect(paneContainerSource).not.toContain("createPortal(");
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

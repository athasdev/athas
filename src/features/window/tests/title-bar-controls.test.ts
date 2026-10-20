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
  fileURLToPath(new URL("../../auth/components/account-menu.tsx", import.meta.url)),
  "utf8",
);
const workbenchSidebarSource = readFileSync(
  fileURLToPath(new URL("../../layout/components/sidebar/workbench-sidebar.tsx", import.meta.url)),
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
const branchManagerSource = readFileSync(
  fileURLToPath(new URL("../../git/components/git-branch-manager.tsx", import.meta.url)),
  "utf8",
);
const dropdownSource = readFileSync(
  fileURLToPath(new URL("../../../ui/dropdown.tsx", import.meta.url)),
  "utf8",
);

describe("title bar controls", () => {
  it("leads the title bar with the sidebar toggle, then back and forward, with no branch picker", () => {
    const toggleIndex = titleLeadingSource.indexOf("<Toggle");
    const navigationIndex = titleLeadingSource.indexOf("<TabHistoryNavigation />");

    expect(toggleIndex).toBeGreaterThan(-1);
    expect(navigationIndex).toBeGreaterThan(toggleIndex);
    expect(titleLeadingSource).not.toContain("ProjectSwitcher");
    expect(titleLeadingSource).not.toContain("GitBranchManager");
    expect(titleLeadingSource).toContain('useCommandShortcut("workbench.toggleSidebar")');
    expect(workbenchSidebarSource).toContain("<SidebarProjects />");
  });

  it("keeps back and forward out of the pane tab bar", () => {
    expect(tabHistoryNavigationSource).toContain("export function TabHistoryNavigation");
    expect(mainLayoutSource).not.toContain("titleActions=");
    expect(tabBarSource).not.toContain("<TabHistoryNavigation />");
  });

  it("puts the account first and the update, run, terminal and notifications after it in the sidebar footer", () => {
    const accountIndex = workbenchSidebarSource.indexOf("<AccountMenu />");
    const updateIndex = workbenchSidebarSource.indexOf("<AppUpdateControl");
    const runActionsIndex = workbenchSidebarSource.indexOf("<RunActionsButton");
    const terminalIndex = workbenchSidebarSource.indexOf("<TerminalToggle />");
    const notificationsIndex = workbenchSidebarSource.indexOf("<NotificationsTrigger");

    expect(accountIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(accountIndex);
    expect(runActionsIndex).toBeGreaterThan(updateIndex);
    expect(terminalIndex).toBeGreaterThan(runActionsIndex);
    expect(notificationsIndex).toBeGreaterThan(terminalIndex);
    expect(accountMenuSource).toContain("<SidebarIconButton");
    expect(accountMenuSource).not.toContain("<SidebarListItem");
    // The footer's overlay placement opens its menus upward.
    expect(accountMenuSource).toContain('<DropdownMenuContent size="wide">');
    expect(workbenchSidebarSource).toContain('<OverlaySideProvider side="top" align="start">');
  });

  it("keeps search and a new session at the top of the sidebar", () => {
    const searchIndex = workbenchSidebarSource.indexOf("<SearchIcon />");
    const newSessionIndex = workbenchSidebarSource.indexOf("New session");
    expect(searchIndex).toBeGreaterThan(-1);
    expect(newSessionIndex).toBeGreaterThan(searchIndex);
    expect(workbenchSidebarSource).toContain("Integrations");
  });

  it("keeps native window controls over the workbench", () => {
    expect(titleBarSource).toContain("pointer-events-none absolute top-0 right-0 w-auto");
    expect(mainLayoutSource.indexOf("<TitleBarWithSettings showMinimal overlay")).toBeGreaterThan(
      mainLayoutSource.indexOf("<WorkbenchSidebar"),
    );
  });

  it("keeps pane tabs inside the main view instead of the title bar", () => {
    expect(mainLayoutSource).toContain('data-slot="workbench-title-row"');
    expect(mainLayoutSource).not.toContain("main-title-tab-bar");
    expect(paneContainerSource).toContain("<TabBar");
    expect(paneContainerSource).not.toContain("createPortal(");
  });

  it("uses a searchable anchored menu for branch selection", () => {
    expect(branchManagerSource).toContain('if (triggerMode === "branch")');
    expect(branchManagerSource).toContain('placeholder="Search branches"');
    expect(branchManagerSource).toContain('viewport="searchable"');
    expect(branchManagerSource).toContain("<DropdownMenuViewport>");
    expect(branchManagerSource).toContain("<DropdownMenuFooter>");
    expect(branchManagerSource).toContain("<BranchDropdownActions");
    expect(branchManagerSource).toContain("New branch…");
    expect(dropdownSource).toContain(
      'className="sticky top-0 z-20 shrink-0 overflow-clip border-divider border-b bg-overlay p-1"',
    );
    expect(dropdownSource).toContain('data-slot="dropdown-menu-viewport"');
    expect(dropdownSource).toContain('data-slot="dropdown-menu-footer"');
    expect(dropdownSource).toContain("openOnHover");
    expect(dropdownSource).toContain("has-data-popup-open:opacity-100");
    expect(dropdownSource).toContain("onMouseMove={(event) => event.stopPropagation()}");
  });
});

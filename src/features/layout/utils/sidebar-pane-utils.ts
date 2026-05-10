export type SidebarView =
  | "files"
  | "git"
  | "github-prs"
  | "outline"
  | "collaboration"
  | "notifications"
  | "multi-agents"
  | (string & {});

interface SidebarPaneState {
  isSidebarVisible: boolean;
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  activeSidebarView?: SidebarView;
}

interface SidebarPaneClickResult {
  nextIsSidebarVisible: boolean;
  nextView: SidebarView;
}

export function getActiveSidebarView({
  isGitViewActive,
  isGitHubPRsViewActive,
  activeSidebarView,
}: Omit<SidebarPaneState, "isSidebarVisible">): SidebarView {
  if (isGitViewActive) return "git";
  if (isGitHubPRsViewActive) return "github-prs";
  return activeSidebarView ?? "files";
}

export function resolveSidebarPaneClick(
  state: SidebarPaneState,
  clickedView: SidebarView,
): SidebarPaneClickResult {
  const activeView = getActiveSidebarView(state);

  if (!state.isSidebarVisible) {
    return {
      nextIsSidebarVisible: true,
      nextView: clickedView,
    };
  }

  if (activeView === clickedView) {
    return {
      nextIsSidebarVisible: false,
      nextView: activeView,
    };
  }

  return {
    nextIsSidebarVisible: true,
    nextView: clickedView,
  };
}

export type SidebarView =
  | "files"
  | "git"
  | "github-prs"
  | "docker"
  | "extensions"
  | "outline"
  | "databases"
  | "collaboration"
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

export type SidebarPosition = "left" | "right";
export type SidebarTriggerSide = SidebarPosition | "current";
export type SidebarPaneLevel = "primary" | "edge";

interface SidebarPaneTriggerOptions {
  currentPosition: SidebarPosition;
  triggerSide?: SidebarTriggerSide;
}

interface SidebarPaneTriggerResult extends SidebarPaneClickResult {
  nextPosition: SidebarPosition;
}

const EDGE_SIDEBAR_VIEWS = new Set<SidebarView>(["outline", "databases", "collaboration"]);

export function getSidebarPaneLevel(view: SidebarView): SidebarPaneLevel {
  if (EDGE_SIDEBAR_VIEWS.has(view)) return "edge";
  return "primary";
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

export function getSidebarPositionForTrigger(
  currentPosition: SidebarPosition,
  triggerSide: SidebarTriggerSide = "current",
): SidebarPosition {
  return triggerSide === "current" ? currentPosition : triggerSide;
}

export function resolveSidebarPaneTrigger(
  state: SidebarPaneState,
  clickedView: SidebarView,
  options: SidebarPaneTriggerOptions,
): SidebarPaneTriggerResult {
  const nextPosition = getSidebarPositionForTrigger(options.currentPosition, options.triggerSide);
  const isMovingVisibleSidebar = state.isSidebarVisible && nextPosition !== options.currentPosition;

  if (isMovingVisibleSidebar) {
    return {
      nextIsSidebarVisible: true,
      nextView: clickedView,
      nextPosition,
    };
  }

  const { nextIsSidebarVisible, nextView } = resolveSidebarPaneClick(state, clickedView);

  return {
    nextIsSidebarVisible,
    nextView,
    nextPosition,
  };
}

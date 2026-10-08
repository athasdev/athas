import type { ProjectUiSession } from "@/features/workspace/stores/session.store";

export const DEFAULT_PROJECT_UI_STATE: ProjectUiSession = {
  isSidebarVisible: true,
  isBottomPaneVisible: false,
  bottomPaneActiveTab: "terminal",
  activeSidebarView: "files",
  paneState: null,
};

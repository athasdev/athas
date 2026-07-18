import type { ProjectUiSession } from "@/features/window/stores/session.store";

export const DEFAULT_PROJECT_UI_STATE: ProjectUiSession = {
  isSidebarVisible: true,
  isBottomPaneVisible: false,
  bottomPaneActiveTab: "terminal",
  activeSidebarView: "files",
  paneState: null,
};

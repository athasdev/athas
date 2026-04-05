import type { StateCreator } from "zustand";
import type { SidebarView } from "@/features/layout/components/sidebar/sidebar-pane-utils";

export interface ViewState {
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  activeSidebarView: SidebarView;
}

export interface ViewActions {
  setActiveView: (view: SidebarView) => void;
}

export type ViewSlice = ViewState & ViewActions;

export const createViewSlice: StateCreator<ViewSlice, [], [], ViewSlice> = (set) => ({
  // State
  isGitViewActive: false,
  isGitHubPRsViewActive: false,
  activeSidebarView: "files",

  // Actions
  setActiveView: (view: SidebarView) => {
    set({
      isGitViewActive: view === "git",
      isGitHubPRsViewActive: view === "github-prs",
      activeSidebarView: view,
    });
  },
});

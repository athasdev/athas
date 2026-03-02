import type { StateCreator } from "zustand";

export interface ViewState {
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
}

export interface ViewActions {
  setActiveView: (view: "files" | "git" | "github-prs") => void;
}

export type ViewSlice = ViewState & ViewActions;

export const createViewSlice: StateCreator<ViewSlice, [], [], ViewSlice> = (set) => ({
  // State
  isGitViewActive: false,
  isGitHubPRsViewActive: false,

  // Actions
  setActiveView: (view: "files" | "git" | "github-prs") => {
    set({
      isGitViewActive: view === "git",
      isGitHubPRsViewActive: view === "github-prs",
    });
  },
});

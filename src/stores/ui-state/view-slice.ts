import type { StateCreator } from "zustand";

export interface ViewState {
  isGitViewActive: boolean;
  isSearchViewActive: boolean;
  isGitHubPRsViewActive: boolean;
}

export interface ViewActions {
  setIsSearchViewActive: (v: boolean) => void;
  setActiveView: (view: "files" | "git" | "search" | "github-prs") => void;
}

export type ViewSlice = ViewState & ViewActions;

export const createViewSlice: StateCreator<ViewSlice, [], [], ViewSlice> = (set) => ({
  // State
  isGitViewActive: false,
  isSearchViewActive: false,
  isGitHubPRsViewActive: false,

  // Actions
  setIsSearchViewActive: (v: boolean) => set({ isSearchViewActive: v }),
  setActiveView: (view: "files" | "git" | "search" | "github-prs") => {
    set({
      isGitViewActive: view === "git",
      isSearchViewActive: view === "search",
      isGitHubPRsViewActive: view === "github-prs",
    });
  },
});

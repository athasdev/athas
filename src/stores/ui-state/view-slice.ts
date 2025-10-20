import type { StateCreator } from "zustand";

export interface ViewState {
  isGitViewActive: boolean;
  isSearchViewActive: boolean;
  isRemoteViewActive: boolean;
  isExtensionsViewActive: boolean;
  isGitHubCopilotSettingsVisible: boolean;
}

export interface ViewActions {
  setIsSearchViewActive: (v: boolean) => void;
  setIsGitHubCopilotSettingsVisible: (v: boolean) => void;
  setActiveView: (view: "files" | "git" | "search" | "remote" | "extensions") => void;
}

export type ViewSlice = ViewState & ViewActions;

export const createViewSlice: StateCreator<ViewSlice, [], [], ViewSlice> = (set) => ({
  // State
  isGitViewActive: false,
  isSearchViewActive: false,
  isRemoteViewActive: false,
  isExtensionsViewActive: false,
  isGitHubCopilotSettingsVisible: false,

  // Actions
  setIsSearchViewActive: (v: boolean) => set({ isSearchViewActive: v }),
  setIsGitHubCopilotSettingsVisible: (v: boolean) => set({ isGitHubCopilotSettingsVisible: v }),
  setActiveView: (view: "files" | "git" | "search" | "remote" | "extensions") => {
    set({
      isGitViewActive: view === "git",
      isSearchViewActive: view === "search",
      isRemoteViewActive: view === "remote",
      isExtensionsViewActive: view === "extensions",
    });
  },
});

import type { StateCreator } from "zustand";
import type { BottomPaneTab } from "@/stores/ui-state/types";

export interface PanelState {
  isSidebarVisible: boolean;
  isFindVisible: boolean;
  isBottomPaneVisible: boolean;
  bottomPaneActiveTab: BottomPaneTab;
}

export interface PanelActions {
  setIsSidebarVisible: (v: boolean) => void;
  setIsFindVisible: (v: boolean) => void;
  setIsBottomPaneVisible: (v: boolean) => void;
  setBottomPaneActiveTab: (tab: BottomPaneTab) => void;
}

export type PanelSlice = PanelState & PanelActions;

export const createPanelSlice: StateCreator<PanelSlice, [], [], PanelSlice> = (set) => ({
  // State
  isSidebarVisible: true,
  isFindVisible: false,
  isBottomPaneVisible: false,
  bottomPaneActiveTab: "terminal",

  // Actions
  setIsSidebarVisible: (v: boolean) => set({ isSidebarVisible: v }),
  setIsFindVisible: (v: boolean) => set({ isFindVisible: v }),
  setIsBottomPaneVisible: (v: boolean) => set({ isBottomPaneVisible: v }),
  setBottomPaneActiveTab: (tab: BottomPaneTab) => set({ bottomPaneActiveTab: tab }),
});

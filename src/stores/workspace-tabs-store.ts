import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";

export interface ProjectTab {
  id: string;
  name: string;
  path: string;
  isActive: boolean;
  lastOpened: number;
}

interface WorkspaceTabsState {
  projectTabs: ProjectTab[];
}

interface WorkspaceTabsActions {
  addProjectTab: (path: string, name: string) => void;
  removeProjectTab: (projectId: string) => void;
  setActiveProjectTab: (projectId: string) => void;
  reorderProjectTabs: (fromIndex: number, toIndex: number) => void;
  closeAllProjectTabs: () => void;
  getActiveProjectTab: () => ProjectTab | undefined;
  hasProjectTab: (path: string) => boolean;
}

const useWorkspaceTabsStoreBase = create<WorkspaceTabsState & WorkspaceTabsActions>()(
  persist(
    immer((set, get) => ({
      projectTabs: [],

      addProjectTab: (path: string, name: string) => {
        const existing = get().projectTabs.find((tab) => tab.path === path);

        if (existing) {
          // If tab already exists, just activate it
          get().setActiveProjectTab(existing.id);
          return;
        }

        set((state) => {
          // Deactivate all other tabs
          state.projectTabs.forEach((tab) => {
            tab.isActive = false;
          });

          // Add new tab
          state.projectTabs.push({
            id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name,
            path,
            isActive: true,
            lastOpened: Date.now(),
          });
        });
      },

      removeProjectTab: (projectId: string) => {
        const tabs = get().projectTabs;

        const tabIndex = tabs.findIndex((tab) => tab.id === projectId);
        if (tabIndex === -1) return;

        const wasActive = tabs[tabIndex].isActive;

        set((state) => {
          state.projectTabs = state.projectTabs.filter((tab) => tab.id !== projectId);
        });

        // If we closed the active tab, activate another one
        if (wasActive) {
          const newTabs = get().projectTabs;
          if (newTabs.length > 0) {
            // Activate the tab before the closed one, or the first tab if we closed the first
            const newActiveIndex = Math.max(0, tabIndex - 1);
            get().setActiveProjectTab(newTabs[newActiveIndex].id);
          }
        }
      },

      setActiveProjectTab: (projectId: string) => {
        set((state) => {
          state.projectTabs.forEach((tab) => {
            tab.isActive = tab.id === projectId;
            if (tab.id === projectId) {
              tab.lastOpened = Date.now();
            }
          });
        });
      },

      reorderProjectTabs: (fromIndex: number, toIndex: number) => {
        set((state) => {
          const [movedTab] = state.projectTabs.splice(fromIndex, 1);
          state.projectTabs.splice(toIndex, 0, movedTab);
        });
      },

      closeAllProjectTabs: () => {
        set((state) => {
          state.projectTabs = [];
        });
      },

      getActiveProjectTab: () => {
        return get().projectTabs.find((tab) => tab.isActive);
      },

      hasProjectTab: (path: string) => {
        return get().projectTabs.some((tab) => tab.path === path);
      },
    })),
    {
      name: "workspace-tabs-storage",
      version: 1,
    },
  ),
);

export const useWorkspaceTabsStore = createSelectors(useWorkspaceTabsStoreBase);

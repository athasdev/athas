import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { reorderProjectTabItems } from "../utils/project-tab-order";
import {
  areProjectTabPathsEqual,
  createProjectTabId,
  normalizeProjectTabPath,
} from "../utils/project-tab-path";
import {
  getWorkspaceTabsStorageKey,
  removeStaleWorkspaceTabsStorageKeys,
} from "../utils/workspace-tabs-storage";

export interface ProjectTab {
  id: string;
  name: string;
  path: string;
  isActive: boolean;
  lastOpened: number;
  customIcon?: string;
}

interface WorkspaceTabsState {
  projectTabs: ProjectTab[];
}

interface WorkspaceTabsActions {
  addProjectTab: (path: string, name: string) => void;
  removeProjectTab: (projectId: string) => void;
  setActiveProjectTab: (projectId: string) => void;
  reorderProjectTabs: (fromIndex: number, toIndex: number) => void;
  getActiveProjectTab: () => ProjectTab | undefined;
  hasProjectTab: (path: string) => boolean;
  setProjectIcon: (projectId: string, iconPath: string | undefined) => void;
}

const currentWebviewWindow = getCurrentWebviewWindow();
const workspaceTabsStorageKey = getWorkspaceTabsStorageKey(currentWebviewWindow.label);

void (async () => {
  try {
    const activeWindowLabels = new Set(
      (await getAllWebviewWindows()).map((window) => window.label),
    );
    activeWindowLabels.add(currentWebviewWindow.label);
    removeStaleWorkspaceTabsStorageKeys(localStorage, activeWindowLabels);
  } catch (error) {
    console.warn("[workspace-tabs] failed to clean stale tab storage", error);
  }
})();

const useWorkspaceTabsStoreBase = create<WorkspaceTabsState & WorkspaceTabsActions>()(
  persist(
    immer((set, get) => ({
      projectTabs: [],

      addProjectTab: (path: string, name: string) => {
        const normalizedPath = normalizeProjectTabPath(path);
        const existing = get().projectTabs.find((tab) =>
          areProjectTabPathsEqual(tab.path, normalizedPath),
        );

        if (existing) {
          set((state) => {
            const tab = state.projectTabs.find((projectTab) => projectTab.id === existing.id);
            if (tab) {
              tab.name = name;
              tab.path = normalizedPath;
            }
          });
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
            id: createProjectTabId(normalizedPath),
            name,
            path: normalizedPath,
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
          state.projectTabs = reorderProjectTabItems(state.projectTabs, fromIndex, toIndex);
        });
      },

      getActiveProjectTab: () => {
        return get().projectTabs.find((tab) => tab.isActive);
      },

      hasProjectTab: (path: string) => {
        return get().projectTabs.some((tab) => areProjectTabPathsEqual(tab.path, path));
      },

      setProjectIcon: (projectId: string, iconPath: string | undefined) => {
        set((state) => {
          const tab = state.projectTabs.find((t) => t.id === projectId);
          if (tab) {
            tab.customIcon = iconPath;
          }
        });
      },
    })),
    {
      name: workspaceTabsStorageKey,
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

export const useWorkspaceTabsStore = createSelectors(useWorkspaceTabsStoreBase);

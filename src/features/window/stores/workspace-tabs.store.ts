import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";
import { removeProjectTabItems } from "../utils/project-tab-close";
import { reorderProjectTabItems } from "../utils/project-tab-order";
import { renameRemoteProjectTabs } from "../utils/project-tab-remote";
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
  theme?: string;
}

interface WorkspaceTabsState {
  projectTabs: ProjectTab[];
}

interface WorkspaceTabsActions {
  addProjectTab: (path: string, name: string, theme?: string) => void;
  removeProjectTab: (projectId: string) => void;
  setActiveProjectTab: (projectId: string) => void;
  reorderProjectTabs: (fromIndex: number, toIndex: number) => void;
  getActiveProjectTab: () => ProjectTab | undefined;
  hasProjectTab: (path: string) => boolean;
  renameRemoteProjectTabs: (connectionId: string, connectionName: string) => void;
  setProjectIcon: (projectId: string, iconPath: string | undefined) => void;
  setProjectTheme: (projectId: string, theme: string) => void;
}

const currentWebviewWindow = typeof window === "undefined" ? null : getCurrentWebviewWindow();
const workspaceTabsStorageKey = getWorkspaceTabsStorageKey(currentWebviewWindow?.label ?? "main");

if (currentWebviewWindow) {
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
}

/**
 * Tabs saved before root paths were normalized may carry a repeated separator. Their path and the
 * id derived from it are brought to the current form so opening the same folder finds the tab.
 */
const normalizePersistedProjectTabs = (tabs: ProjectTab[]): ProjectTab[] => {
  const seenIds = new Set<string>();
  const normalizedTabs: ProjectTab[] = [];
  for (const tab of tabs) {
    const path = normalizeProjectTabPath(tab.path);
    if (path === tab.path) {
      if (seenIds.has(tab.id)) continue;
      seenIds.add(tab.id);
      normalizedTabs.push(tab);
      continue;
    }

    const id = createProjectTabId(path);
    const existing = normalizedTabs.find((candidate) => candidate.id === id);
    if (existing) {
      existing.isActive ||= tab.isActive;
      continue;
    }
    seenIds.add(id);
    normalizedTabs.push({ ...tab, id, path });
  }
  return normalizedTabs;
};

interface WorkspaceTabsStore extends WorkspaceTabsState {
  actions: WorkspaceTabsActions;
}

const useWorkspaceTabsStoreBase = create<WorkspaceTabsStore>()(
  persist(
    immer((set, get) => ({
      projectTabs: [],

      actions: {
        addProjectTab: (path: string, name: string, theme?: string) => {
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
            get().actions.setActiveProjectTab(existing.id);
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
              theme,
            });
          });
        },

        removeProjectTab: (projectId: string) => {
          set((state) => {
            state.projectTabs = removeProjectTabItems(state.projectTabs, projectId);
          });
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

        renameRemoteProjectTabs: (connectionId: string, connectionName: string) => {
          set((state) => {
            state.projectTabs = renameRemoteProjectTabs(
              state.projectTabs,
              connectionId,
              connectionName,
            );
          });
        },

        setProjectIcon: (projectId: string, iconPath: string | undefined) => {
          set((state) => {
            const tab = state.projectTabs.find((t) => t.id === projectId);
            if (tab) {
              tab.customIcon = iconPath;
            }
          });
        },

        setProjectTheme: (projectId: string, theme: string) => {
          set((state) => {
            const tab = state.projectTabs.find((projectTab) => projectTab.id === projectId);
            if (tab) {
              tab.theme = theme;
            }
          });
        },
      },
    })),
    {
      name: workspaceTabsStorageKey,
      storage: createSafeJSONStorage<WorkspaceTabsState>(),
      partialize: ({ projectTabs }) => ({ projectTabs }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as WorkspaceTabsState | undefined;
        return {
          ...currentState,
          ...persisted,
          ...(persisted?.projectTabs
            ? { projectTabs: normalizePersistedProjectTabs(persisted.projectTabs) }
            : {}),
          actions: currentState.actions,
        };
      },
      version: 1,
    },
  ),
);

export const useWorkspaceTabsStore = createSelectors(useWorkspaceTabsStoreBase);

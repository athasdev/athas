import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

/** The sidebar view of agent sessions; every other view is a project tool by its id. */
export const AGENTS_SIDEBAR_VIEW = "agents";

interface WorkbenchSidebarState {
  /** What the sidebar shows: the agents (projects and their sessions) or a project tool. */
  activeView: string;
  /** Counts the times a view was asked for, so it can focus its main control each time. */
  focusRequest: number;
  /** The sidebar floats over the centre in a narrow window, where it has no column. */
  overlayOpen: boolean;
  /** Projects folded to their header, by project id. */
  collapsedProjects: Record<string, true>;
  /** The Chats list, of sessions in no open project, folded to its header. */
  chatsCollapsed: boolean;
  actions: {
    showView: (view: string, options?: { focus?: boolean }) => void;
    setOverlayOpen: (open: boolean) => void;
    toggleProjectCollapsed: (projectId: string) => void;
    toggleChatsCollapsed: () => void;
  };
}

const useWorkbenchSidebarStoreBase = create<WorkbenchSidebarState>()(
  persist(
    (set) => ({
      activeView: AGENTS_SIDEBAR_VIEW,
      focusRequest: 0,
      overlayOpen: false,
      collapsedProjects: {},
      chatsCollapsed: false,
      actions: {
        showView: (activeView, options) =>
          set((state) => ({
            activeView,
            focusRequest: state.focusRequest + (options?.focus ? 1 : 0),
          })),
        setOverlayOpen: (overlayOpen) => set({ overlayOpen }),
        toggleProjectCollapsed: (projectId) =>
          set((state) => {
            const collapsedProjects = { ...state.collapsedProjects };
            if (collapsedProjects[projectId]) delete collapsedProjects[projectId];
            else collapsedProjects[projectId] = true;
            return { collapsedProjects };
          }),
        toggleChatsCollapsed: () => set((state) => ({ chatsCollapsed: !state.chatsCollapsed })),
      },
    }),
    {
      name: "athas-workbench-sidebar-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeView: state.activeView,
        collapsedProjects: state.collapsedProjects,
        chatsCollapsed: state.chatsCollapsed,
      }),
    },
  ),
);

export const useWorkbenchSidebarStore = createSelectors(useWorkbenchSidebarStoreBase);

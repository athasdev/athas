import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

interface WorkbenchSidebarState {
  /** Projects folded to their header, by project id. */
  collapsedProjects: Record<string, true>;
  /** The Chats list, of sessions in no open project, folded to its header. */
  chatsCollapsed: boolean;
  actions: {
    toggleProjectCollapsed: (projectId: string) => void;
    toggleChatsCollapsed: () => void;
  };
}

const useWorkbenchSidebarStoreBase = create<WorkbenchSidebarState>()(
  persist(
    (set) => ({
      collapsedProjects: {},
      chatsCollapsed: false,
      actions: {
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
        collapsedProjects: state.collapsedProjects,
        chatsCollapsed: state.chatsCollapsed,
      }),
    },
  ),
);

export const useWorkbenchSidebarStore = createSelectors(useWorkbenchSidebarStoreBase);

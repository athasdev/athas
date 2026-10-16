import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

interface WorkbenchSidebarState {
  /** Projects folded to their header, by project id. */
  collapsedProjects: Record<string, true>;
  /** The sidebar lists the Inbox instead of the projects. */
  inboxOpen: boolean;
  actions: {
    toggleProjectCollapsed: (projectId: string) => void;
    setInboxOpen: (open: boolean) => void;
  };
}

const useWorkbenchSidebarStoreBase = create<WorkbenchSidebarState>()(
  persist(
    (set) => ({
      collapsedProjects: {},
      inboxOpen: false,
      actions: {
        toggleProjectCollapsed: (projectId) =>
          set((state) => {
            const collapsedProjects = { ...state.collapsedProjects };
            if (collapsedProjects[projectId]) delete collapsedProjects[projectId];
            else collapsedProjects[projectId] = true;
            return { collapsedProjects };
          }),
        setInboxOpen: (inboxOpen) => set({ inboxOpen }),
      },
    }),
    {
      name: "athas-workbench-sidebar-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ collapsedProjects: state.collapsedProjects }),
    },
  ),
);

export const useWorkbenchSidebarStore = createSelectors(useWorkbenchSidebarStoreBase);

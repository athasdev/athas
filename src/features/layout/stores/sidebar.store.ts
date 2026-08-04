import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

interface SidebarState {
  activePath?: string;
  actions: {
    updateActivePath: (path: string) => void;
  };
}

const createSidebarStore = () =>
  createStore<SidebarState>()((set) => ({
    activePath: undefined,
    actions: {
      updateActivePath: (path: string) => {
        set({ activePath: path });
      },
    },
  }));

export const useSidebarStore = createWorkspaceScopedStore("sidebar", createSidebarStore);

import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { createSelectors } from "@/utils/zustand-selectors";

interface SidebarState {
  activePath?: string;
  updateActivePath: (path: string) => void;
}

const createSidebarStore = () =>
  createStore<SidebarState>()((set) => ({
    activePath: undefined,
    updateActivePath: (path: string) => {
      set({ activePath: path });
    },
  }));

export const useSidebarStore = createSelectors(
  createWorkspaceScopedStore("sidebar", createSidebarStore),
);

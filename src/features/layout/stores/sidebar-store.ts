import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface SidebarState {
  activePath?: string;
  updateActivePath: (path: string) => void;
}

const useSidebarStoreBase = create<SidebarState>()((set) => ({
  activePath: undefined,
  updateActivePath: (path: string) => {
    set({ activePath: path });
  },
}));

export const useSidebarStore = createSelectors(useSidebarStoreBase);

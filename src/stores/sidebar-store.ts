import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface SidebarState {
  activePath?: string;
  isRemoteWindow: boolean;
  remoteConnectionName?: string;
  updateActivePath: (path: string) => void;
}

const useSidebarStoreBase = create<SidebarState>()((set) => ({
  isRemoteWindow: false,
  activePath: undefined,
  updateActivePath: (path: string) => {
    set({ activePath: path });
  },
}));

export const useSidebarStore = createSelectors(useSidebarStoreBase);

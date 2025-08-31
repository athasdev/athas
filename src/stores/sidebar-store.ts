import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface SidebarState {
  activePath?: string;
  isRemoteWindow: boolean;
  remoteConnectionId?: string;
  remoteConnectionName?: string;
  updateActivePath: (path: string) => void;
  setRemoteWindow: (isRemote: boolean, connectionName?: string, connectionId?: string) => void;
}

const useSidebarStoreBase = create<SidebarState>()((set) => ({
  isRemoteWindow: false,
  activePath: undefined,
  updateActivePath: (path: string) => {
    set({ activePath: path });
  },
  setRemoteWindow: (isRemote: boolean, connectionName?: string, connectionId?: string) => {
    set({
      isRemoteWindow: isRemote,
      remoteConnectionName: connectionName,
      remoteConnectionId: connectionId,
    });
  },
}));

export const useSidebarStore = createSelectors(useSidebarStoreBase);

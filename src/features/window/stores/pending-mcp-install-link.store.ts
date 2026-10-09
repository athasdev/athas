import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface PendingMcpInstallLinkState {
  url: string | null;
  actions: {
    request: (url: string) => void;
    clear: () => void;
  };
}

/**
 * An `athas://mcp/install` link waiting for the MCP server settings, which read it into the
 * server dialog so the user can review the server before anything is saved.
 */
const usePendingMcpInstallLinkStoreBase = create<PendingMcpInstallLinkState>()((set) => ({
  url: null,
  actions: {
    request: (url) => set({ url }),
    clear: () => set({ url: null }),
  },
}));

export const usePendingMcpInstallLinkStore = createSelectors(usePendingMcpInstallLinkStoreBase);

import { create } from "zustand";
import type { McpServerDraft } from "@/features/ai/types/mcp-server.types";
import { createSelectors } from "@/utils/zustand-selectors";

interface PendingMcpInstallState {
  draft: McpServerDraft | null;
  actions: {
    request: (draft: McpServerDraft) => void;
    clear: () => void;
  };
}

/**
 * A server from an "Add to Athas" link, waiting for the MCP settings to open it in the server
 * dialog so the user can review it before anything is saved.
 */
const usePendingMcpInstallStoreBase = create<PendingMcpInstallState>()((set) => ({
  draft: null,
  actions: {
    request: (draft) => set({ draft }),
    clear: () => set({ draft: null }),
  },
}));

export const usePendingMcpInstallStore = createSelectors(usePendingMcpInstallStoreBase);

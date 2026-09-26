import { create } from "zustand";
import type { AcpNotice } from "@/features/ai/types/acp.types";
import { createSelectors } from "@/utils/zustand-selectors";

/** How many notices each session keeps; older ones drop off. */
const NOTICES_PER_SESSION = 20;

interface AcpNoticesState {
  notices: Record<string, AcpNotice[]>;
  actions: {
    add: (sessionId: string, notice: Omit<AcpNotice, "id" | "timestamp">) => void;
  };
}

/**
 * Notices agents send (ACP `notice`), by session id. They are live information for the user,
 * not conversation, so they stay in memory and are never saved with the chat.
 */
const useAcpNoticesStoreBase = create<AcpNoticesState>()((set) => ({
  notices: {},
  actions: {
    add: (sessionId, notice) =>
      set((state) => ({
        notices: {
          ...state.notices,
          [sessionId]: [
            ...(state.notices[sessionId] ?? []),
            { ...notice, id: crypto.randomUUID(), timestamp: new Date() },
          ].slice(-NOTICES_PER_SESSION),
        },
      })),
  },
}));

export const useAcpNoticesStore = createSelectors(useAcpNoticesStoreBase);

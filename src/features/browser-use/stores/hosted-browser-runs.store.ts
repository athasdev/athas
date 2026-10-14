import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

/** A browser task an agent runs on Athas's hosted browser, by the chat that asked for it. */
export interface HostedBrowserRun {
  url: string;
  startedAt: number;
}

interface HostedBrowserRunsState {
  runs: Record<string, HostedBrowserRun>;
  actions: {
    start: (chatId: string, url: string) => void;
    finish: (chatId: string) => void;
  };
}

export const useHostedBrowserRunsStore = createSelectors(
  create<HostedBrowserRunsState>()((set) => ({
    runs: {},
    actions: {
      start: (chatId, url) =>
        set((state) => ({ runs: { ...state.runs, [chatId]: { url, startedAt: Date.now() } } })),
      finish: (chatId) =>
        set((state) => {
          if (!state.runs[chatId]) return state;
          const runs = { ...state.runs };
          delete runs[chatId];
          return { runs };
        }),
    },
  })),
);

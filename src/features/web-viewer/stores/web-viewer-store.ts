import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Bookmark, HistoryEntry } from "../types";
import { createSelectors } from "@/utils/zustand-selectors";

const MAX_HISTORY_ENTRIES = 1000;

interface WebViewerStoreState {
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  defaultHomePage: string;
  searchEngine: "google" | "duckduckgo" | "bing";
  defaultZoom: number;
  responsiveMode: boolean;
  activeDevicePresetId: string | null;
  customDimensions: { width: number; height: number } | null;
  actions: {
    addHistoryEntry: (entry: Omit<HistoryEntry, "timestamp">) => void;
    clearHistory: () => void;
    removeHistoryEntry: (url: string, timestamp: number) => void;
    getRecentSites: (limit?: number) => HistoryEntry[];
    addBookmark: (bookmark: Omit<Bookmark, "id" | "createdAt">) => void;
    removeBookmark: (id: string) => void;
    setResponsiveMode: (enabled: boolean) => void;
    setActiveDevicePreset: (presetId: string | null) => void;
    setCustomDimensions: (dimensions: { width: number; height: number } | null) => void;
    updateSettings: (
      settings: Partial<Pick<WebViewerStoreState, "defaultHomePage" | "searchEngine" | "defaultZoom">>,
    ) => void;
  };
}

const useWebViewerStoreBase = create<WebViewerStoreState>()(
  persist(
    (set, get) => ({
      history: [],
      bookmarks: [],
      defaultHomePage: "",
      searchEngine: "google",
      defaultZoom: 1,
      responsiveMode: false,
      activeDevicePresetId: null,
      customDimensions: null,
      actions: {
        addHistoryEntry: (entry) => {
          set((state) => {
            const lastEntry = state.history[state.history.length - 1];
            if (lastEntry && lastEntry.url === entry.url) {
              return state;
            }

            const newEntry: HistoryEntry = { ...entry, timestamp: Date.now() };
            const updated = [...state.history, newEntry];

            if (updated.length > MAX_HISTORY_ENTRIES) {
              return { history: updated.slice(updated.length - MAX_HISTORY_ENTRIES) };
            }

            return { history: updated };
          });
        },

        clearHistory: () => {
          set({ history: [] });
        },

        removeHistoryEntry: (url, timestamp) => {
          set((state) => ({
            history: state.history.filter((e) => !(e.url === url && e.timestamp === timestamp)),
          }));
        },

        getRecentSites: (limit = 8) => {
          const { history } = get();
          const seen = new Set<string>();
          const recent: HistoryEntry[] = [];

          for (let i = history.length - 1; i >= 0 && recent.length < limit; i--) {
            const hostname = new URL(history[i].url).hostname;
            if (!seen.has(hostname)) {
              seen.add(hostname);
              recent.push(history[i]);
            }
          }

          return recent;
        },

        addBookmark: (bookmark) => {
          const id = `bm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          set((state) => ({
            bookmarks: [...state.bookmarks, { ...bookmark, id, createdAt: Date.now() }],
          }));
        },

        removeBookmark: (id) => {
          set((state) => ({
            bookmarks: state.bookmarks.filter((b) => b.id !== id),
          }));
        },

        setResponsiveMode: (enabled) => {
          set({ responsiveMode: enabled });
        },

        setActiveDevicePreset: (presetId) => {
          set({ activeDevicePresetId: presetId });
        },

        setCustomDimensions: (dimensions) => {
          set({ customDimensions: dimensions });
        },

        updateSettings: (settings) => {
          set(settings);
        },
      },
    }),
    {
      name: "web-viewer-store",
      partialize: (state) => ({
        history: state.history,
        bookmarks: state.bookmarks,
        defaultHomePage: state.defaultHomePage,
        searchEngine: state.searchEngine,
        defaultZoom: state.defaultZoom,
        responsiveMode: state.responsiveMode,
        activeDevicePresetId: state.activeDevicePresetId,
        customDimensions: state.customDimensions,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<WebViewerStoreState>),
        actions: currentState.actions,
      }),
    },
  ),
);

export const useWebViewerStore = createSelectors(useWebViewerStoreBase);

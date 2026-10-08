import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

/** Live page state of a browser tab. The address, title and zoom live on its buffer. */
export interface BrowserTabState {
  isLoading: boolean;
  /** `null` while the engine can't tell, in which case the history buttons stay enabled. */
  canGoBack: boolean | null;
  canGoForward: boolean | null;
  error: string | null;
  /** A picture of the page shown while workbench UI covers it. */
  snapshotUrl: string | null;
}

const EMPTY_TAB_STATE: BrowserTabState = {
  isLoading: false,
  canGoBack: null,
  canGoForward: null,
  error: null,
  snapshotUrl: null,
};

interface BrowserTabStoreState {
  tabs: Record<string, BrowserTabState>;
  /** The browser tab whose page has keyboard focus, if any. */
  focusedBufferId: string | null;
  actions: {
    patchTab: (bufferId: string, patch: Partial<BrowserTabState>) => void;
    removeTab: (bufferId: string) => void;
    setFocusedBufferId: (bufferId: string | null) => void;
  };
}

export const useBrowserTabStore = createSelectors(
  create<BrowserTabStoreState>()((set) => ({
    tabs: {},
    focusedBufferId: null,
    actions: {
      patchTab: (bufferId, patch) =>
        set((state) => {
          const current = state.tabs[bufferId] ?? EMPTY_TAB_STATE;
          const changed = (Object.keys(patch) as (keyof BrowserTabState)[]).some(
            (key) => patch[key] !== current[key],
          );
          if (!changed) return state;
          return { tabs: { ...state.tabs, [bufferId]: { ...current, ...patch } } };
        }),
      removeTab: (bufferId) =>
        set((state) => {
          if (!(bufferId in state.tabs) && state.focusedBufferId !== bufferId) return state;
          const tabs = { ...state.tabs };
          delete tabs[bufferId];
          return {
            tabs,
            focusedBufferId: state.focusedBufferId === bufferId ? null : state.focusedBufferId,
          };
        }),
      setFocusedBufferId: (bufferId) => set({ focusedBufferId: bufferId }),
    },
  })),
);

export function useBrowserTabState(bufferId: string): BrowserTabState {
  return useBrowserTabStore((state) => state.tabs[bufferId] ?? EMPTY_TAB_STATE);
}

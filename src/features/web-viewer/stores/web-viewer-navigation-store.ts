import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface WebViewerNavigationEntry {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack?: () => void;
  goForward?: () => void;
}

interface WebViewerNavigationState {
  navigationByBufferId: Record<string, WebViewerNavigationEntry>;
  actions: {
    setNavigationState: (
      bufferId: string,
      state: Pick<WebViewerNavigationEntry, "canGoBack" | "canGoForward">,
    ) => void;
    registerNavigationActions: (
      bufferId: string,
      actions: Pick<WebViewerNavigationEntry, "goBack" | "goForward">,
    ) => void;
    unregisterNavigationActions: (bufferId: string) => void;
  };
}

export const useWebViewerNavigationStore = createSelectors(
  create<WebViewerNavigationState>()((set) => ({
    navigationByBufferId: {},
    actions: {
      setNavigationState: (bufferId, state) => {
        set((current) => ({
          navigationByBufferId: {
            ...current.navigationByBufferId,
            [bufferId]: {
              ...current.navigationByBufferId[bufferId],
              ...state,
            },
          },
        }));
      },
      registerNavigationActions: (bufferId, actions) => {
        set((current) => ({
          navigationByBufferId: {
            ...current.navigationByBufferId,
            [bufferId]: {
              canGoBack: current.navigationByBufferId[bufferId]?.canGoBack ?? false,
              canGoForward: current.navigationByBufferId[bufferId]?.canGoForward ?? false,
              ...actions,
            },
          },
        }));
      },
      unregisterNavigationActions: (bufferId) => {
        set((current) => {
          const { [bufferId]: _removed, ...navigationByBufferId } = current.navigationByBufferId;
          return { navigationByBufferId };
        });
      },
    },
  })),
);

import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const DEFAULT_ZOOM = 1.0;

interface ZoomState {
  zoomLevel: number;
  showZoomIndicator: boolean;
  zoomIndicatorTimeout: NodeJS.Timeout | null;
  actions: ZoomActions;
}

interface ZoomActions {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  showZoomIndicatorTemporarily: () => void;
}

export const useZoomStore = createSelectors(
  create<ZoomState>()((set, get) => {
    const showZoomIndicatorTemporarily = () => {
      const state = get();

      if (state.zoomIndicatorTimeout) {
        clearTimeout(state.zoomIndicatorTimeout);
      }

      set({
        showZoomIndicator: true,
        zoomIndicatorTimeout: setTimeout(() => {
          set({ showZoomIndicator: false, zoomIndicatorTimeout: null });
        }, 1500),
      });
    };

    return {
      zoomLevel: DEFAULT_ZOOM,
      showZoomIndicator: false,
      zoomIndicatorTimeout: null,
      actions: {
        zoomIn: () => {
          const current = get().zoomLevel;
          const currentIndex = ZOOM_LEVELS.findIndex((level) => level >= current);
          const nextIndex = Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1);
          const newZoom = ZOOM_LEVELS[nextIndex];

          if (newZoom !== current) {
            set({ zoomLevel: newZoom });
            showZoomIndicatorTemporarily();
          }
        },

        zoomOut: () => {
          const current = get().zoomLevel;
          const currentIndex = ZOOM_LEVELS.findIndex((level) => level >= current);
          const prevIndex = Math.max(currentIndex - 1, 0);
          const newZoom = ZOOM_LEVELS[prevIndex];

          if (newZoom !== current) {
            set({ zoomLevel: newZoom });
            showZoomIndicatorTemporarily();
          }
        },

        resetZoom: () => {
          if (get().zoomLevel !== DEFAULT_ZOOM) {
            set({ zoomLevel: DEFAULT_ZOOM });
            showZoomIndicatorTemporarily();
          }
        },

        showZoomIndicatorTemporarily,
      },
    };
  }),
);

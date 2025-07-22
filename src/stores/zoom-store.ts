import { create } from "zustand";
import { combine } from "zustand/middleware";

const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const DEFAULT_ZOOM = 1.0;
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

const initialState = {
  zoomLevel: DEFAULT_ZOOM,
  showZoomIndicator: false,
  zoomIndicatorTimeout: null as NodeJS.Timeout | null,
};

export const useZoomStore = create(
  combine(initialState, (set, get) => {
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
      zoomIn: () => {
        const current = get().zoomLevel;
        const currentIndex = ZOOM_LEVELS.findIndex(level => level >= current);
        const nextIndex = Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1);
        const newZoom = ZOOM_LEVELS[nextIndex];

        if (newZoom !== current) {
          set({ zoomLevel: newZoom });
          showZoomIndicatorTemporarily();
        }
      },

      zoomOut: () => {
        const current = get().zoomLevel;
        const currentIndex = ZOOM_LEVELS.findIndex(level => level >= current);
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

      setZoomLevel: (level: number) => {
        const clampedLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
        set({ zoomLevel: clampedLevel });
        showZoomIndicatorTemporarily();
      },

      showZoomIndicatorTemporarily,

      hideZoomIndicator: () => {
        const state = get();
        if (state.zoomIndicatorTimeout) {
          clearTimeout(state.zoomIndicatorTimeout);
        }
        set({ showZoomIndicator: false, zoomIndicatorTimeout: null });
      },

      getZoomPercentage: () => Math.round(get().zoomLevel * 100),
    };
  }),
);

export type ZoomStore = ReturnType<typeof useZoomStore>;

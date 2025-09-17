import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const DEFAULT_ZOOM = 1.0;

type ZoomType = "window" | "editor" | "terminal";

interface ZoomState {
  // zoomLevel: number;
  windowZoomLevel: number;
  editorZoomLevel: number;
  terminalZoomLevel: number;
  showZoomIndicator: boolean;
  zoomIndicatorTimeout: NodeJS.Timeout | null;
  actions: ZoomActions;
}

interface ZoomActions {
  zoomIn: (type: ZoomType) => void;
  zoomOut: (type: ZoomType) => void;
  resetZoom: (type: ZoomType) => void;
  showZoomIndicatorTemporarily: () => void;
  getZoomPercentage: (type: ZoomType) => number;
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
      windowZoomLevel: DEFAULT_ZOOM,
      editorZoomLevel: DEFAULT_ZOOM,
      terminalZoomLevel: DEFAULT_ZOOM,
      showZoomIndicator: false,
      zoomIndicatorTimeout: null,
      actions: {
        zoomIn: (type: ZoomType) => {
          const current = get()[`${type}ZoomLevel`];
          const currentIndex = ZOOM_LEVELS.findIndex((level) => level >= current);
          const nextIndex = Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1);
          const newZoom = ZOOM_LEVELS[nextIndex];
          console.log("zoomIn", type, newZoom);
          if (newZoom !== current) {
            set({ [`${type}ZoomLevel`]: newZoom });
            showZoomIndicatorTemporarily();
          }
        },

        zoomOut: (type: ZoomType) => {
          const current = get()[`${type}ZoomLevel`];
          const currentIndex = ZOOM_LEVELS.findIndex((level) => level >= current);
          const prevIndex = Math.max(currentIndex - 1, 0);
          const newZoom = ZOOM_LEVELS[prevIndex];

          if (newZoom !== current) {
            set({ [`${type}ZoomLevel`]: newZoom });
            showZoomIndicatorTemporarily();
          }
        },

        resetZoom: (type: ZoomType) => {
          if ((get()[`${type}ZoomLevel` as keyof ZoomState] as number) !== DEFAULT_ZOOM) {
            set({ [`${type}ZoomLevel`]: DEFAULT_ZOOM });
            showZoomIndicatorTemporarily();
          }
        },

        showZoomIndicatorTemporarily,

        getZoomPercentage: (type: ZoomType) =>
          Math.round((get()[`${type}ZoomLevel` as keyof ZoomState] as number) * 100),
      },
    };
  }),
);

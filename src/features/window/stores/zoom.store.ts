import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const DEFAULT_ZOOM = 1.0;

type ZoomType = "editor" | "terminal";

interface ZoomState {
  editorZoomLevel: number;
  terminalZoomLevel: number;
  showZoomIndicator: boolean;
  zoomIndicatorType: ZoomType | null;
  zoomIndicatorTimeout: NodeJS.Timeout | null;
  actions: ZoomActions;
}

interface ZoomActions {
  zoomIn: (type: ZoomType) => void;
  zoomOut: (type: ZoomType) => void;
  resetZoom: (type: ZoomType) => void;
  showZoomIndicatorTemporarily: (type: ZoomType) => void;
  getZoomPercentage: (type: ZoomType) => number;
}

export const useZoomStore = createSelectors(
  create<ZoomState>()((set, get) => {
    const showZoomIndicatorTemporarily = (type: ZoomType) => {
      const state = get();

      if (state.zoomIndicatorTimeout) {
        clearTimeout(state.zoomIndicatorTimeout);
      }

      set({
        showZoomIndicator: true,
        zoomIndicatorType: type,
        zoomIndicatorTimeout: setTimeout(() => {
          set({ showZoomIndicator: false, zoomIndicatorType: null, zoomIndicatorTimeout: null });
        }, 1500),
      });
    };

    return {
      editorZoomLevel: DEFAULT_ZOOM,
      terminalZoomLevel: DEFAULT_ZOOM,
      showZoomIndicator: false,
      zoomIndicatorType: null,
      zoomIndicatorTimeout: null,
      actions: {
        zoomIn: (type: ZoomType) => {
          const current = get()[`${type}ZoomLevel`];
          const currentIndex = ZOOM_LEVELS.findIndex((level) => level >= current);
          const nextIndex = Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1);
          const newZoom = ZOOM_LEVELS[nextIndex];
          if (newZoom !== current) {
            set({ [`${type}ZoomLevel`]: newZoom });
            showZoomIndicatorTemporarily(type);
          }
        },

        zoomOut: (type: ZoomType) => {
          const current = get()[`${type}ZoomLevel`];
          const currentIndex = ZOOM_LEVELS.findIndex((level) => level >= current);
          const prevIndex = Math.max(currentIndex - 1, 0);
          const newZoom = ZOOM_LEVELS[prevIndex];

          if (newZoom !== current) {
            set({ [`${type}ZoomLevel`]: newZoom });
            showZoomIndicatorTemporarily(type);
          }
        },

        resetZoom: (type: ZoomType) => {
          if ((get()[`${type}ZoomLevel` as keyof ZoomState] as number) !== DEFAULT_ZOOM) {
            set({ [`${type}ZoomLevel`]: DEFAULT_ZOOM });
            showZoomIndicatorTemporarily(type);
          }
        },

        showZoomIndicatorTemporarily,

        getZoomPercentage: (type: ZoomType) =>
          Math.round((get()[`${type}ZoomLevel` as keyof ZoomState] as number) * 100),
      },
    };
  }),
);

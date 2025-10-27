import { useState } from "react";

export interface UseImageZoomOptions {
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  zoomSensitivity?: number;
}

export function useImageZoom(options: UseImageZoomOptions = {}) {
  const { initialZoom = 1, minZoom = 0.1, maxZoom = 5, zoomSensitivity = 0.001 } = options;
  const [zoom, setZoom] = useState<number>(initialZoom);

  const zoomIn = () => setZoom((z) => Math.min(maxZoom, z + 0.1));
  const zoomOut = () => setZoom((z) => Math.max(minZoom, z - 0.1));
  const resetZoom = () => setZoom(initialZoom);

  const handleWheel = (e: WheelEvent) => {
    // Check if Ctrl key is pressed (or Cmd on Mac) for zoom
    // Trackpad pinch gestures also trigger wheel events with ctrlKey
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      // deltaY is positive when scrolling down/pinching in, negative when scrolling up/pinching out
      const delta = -e.deltaY * zoomSensitivity;

      setZoom((currentZoom) => {
        const newZoom = currentZoom + delta;
        return Math.max(minZoom, Math.min(maxZoom, newZoom));
      });
    }
  };

  return {
    zoom,
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom,
    handleWheel,
  };
}

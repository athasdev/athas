import { useState } from "react";

export interface UseImageZoomOptions {
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
}

export function useImageZoom(options: UseImageZoomOptions = {}) {
  const { initialZoom = 1, minZoom = 0.1, maxZoom = 5 } = options;
  const [zoom, setZoom] = useState<number>(initialZoom);

  const zoomIn = () => setZoom((z) => Math.min(maxZoom, z + 0.1));
  const zoomOut = () => setZoom((z) => Math.max(minZoom, z - 0.1));
  const resetZoom = () => setZoom(initialZoom);

  return {
    zoom,
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom,
  };
}

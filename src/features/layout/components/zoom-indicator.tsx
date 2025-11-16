import { useZoomStore } from "../../../stores/zoom-store";

export function ZoomIndicator() {
  const showZoomIndicator = useZoomStore.use.showZoomIndicator();
  const windowZoomLevel = useZoomStore.use.windowZoomLevel();
  const terminalZoomLevel = useZoomStore.use.terminalZoomLevel();

  function getZoomPercentage(zoomLevel: number) {
    return `${Math.round(zoomLevel * 100)}%`;
  }

  if (!showZoomIndicator) {
    return null;
  }

  return (
    <div className="fade-in-0 fade-out-0 fixed top-4 right-4 z-50 animate-in animate-out rounded bg-black/80 px-2 py-1 text-white text-xs backdrop-blur-sm duration-200">
      Window: {getZoomPercentage(windowZoomLevel)}% Terminal: {getZoomPercentage(terminalZoomLevel)}
      %
    </div>
  );
}

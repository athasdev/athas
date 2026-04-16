import { useZoomStore } from "@/features/window/stores/zoom-store";

export function ZoomIndicator() {
  const showZoomIndicator = useZoomStore.use.showZoomIndicator();
  const zoomIndicatorType = useZoomStore.use.zoomIndicatorType();
  const editorZoomLevel = useZoomStore.use.editorZoomLevel();
  const terminalZoomLevel = useZoomStore.use.terminalZoomLevel();

  if (!showZoomIndicator || !zoomIndicatorType) {
    return null;
  }

  const zoomLevel = zoomIndicatorType === "editor" ? editorZoomLevel : terminalZoomLevel;
  const label = zoomIndicatorType === "editor" ? "Editor" : "Terminal";

  return (
    <div className="fade-in-0 fade-out-0 fixed top-4 right-4 z-50 animate-in animate-out rounded bg-black/80 px-2 py-1 text-white text-xs backdrop-blur-sm duration-200">
      {label}: {Math.round(zoomLevel * 100)}%
    </div>
  );
}

import { useZoomStore } from "@/features/window/stores/zoom.store";

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
    <div className="fade-in-0 fade-out-0 fixed top-4 right-4 z-50 animate-out rounded-md bg-overlay px-2 py-1 font-sans text-foreground shadow-(--shadow-popover) ring-1 ring-border ui-text-sm duration-normal">
      {label}: {Math.round(zoomLevel * 100)}%
    </div>
  );
}

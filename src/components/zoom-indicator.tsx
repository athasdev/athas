import { useZoomStore } from "../stores/zoom-store";
import { cn } from "../utils/cn";

export function ZoomIndicator() {
  const showZoomIndicator = useZoomStore.use.showZoomIndicator();
  //const { getZoomPercentage } = useZoomStore.use.actions();
  const windowZoomLevel = useZoomStore.use.windowZoomLevel();
  const terminalZoomLevel = useZoomStore.use.terminalZoomLevel();

  function getZoomPercentage(zoomLevel: number) {
    return `${Math.round(zoomLevel * 100)}%`;
  }

  // const zoomPercentage = useMemo(() => {
  //   return `${Math.round(zoomLevel * 100)}%`;
  // }, [zoomLevel]);

  if (!showZoomIndicator) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed top-4 right-4 z-50",
        "bg-black/80 text-white",
        "rounded px-2 py-1",
        "font-mono text-xs",
        "backdrop-blur-sm",
        "fade-in-0 animate-in duration-200",
        "fade-out-0 animate-out",
      )}
      style={{
        animationFillMode: "forwards",
      }}
    >
      Window: {getZoomPercentage(windowZoomLevel)}% Terminal: {getZoomPercentage(terminalZoomLevel)}
      %
    </div>
  );
}

import { useEffect } from "react";
import { useSettingsStore } from "../settings/store";
import { useZoomStore } from "../stores/zoom-store";

export function useScroll() {
  const { zoomIn, zoomOut } = useZoomStore.use.actions();
  const { settings } = useSettingsStore();

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!settings.mouseWheelZoom) return;

      // Check if Ctrl/Cmd is held (common zoom modifier)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        if (e.deltaY < 0) {
          // Scroll up = zoom in
          zoomIn();
        } else if (e.deltaY > 0) {
          // Scroll down = zoom out
          zoomOut();
        }
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("wheel", handleWheel);
    };
  }, [settings.mouseWheelZoom, zoomIn, zoomOut]);
}

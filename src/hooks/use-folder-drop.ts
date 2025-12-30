import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/**
 * Hook to handle drag-and-drop from OS into the application
 * @param onDrop - Callback when files/folders are dropped (array of paths)
 * @returns isDraggingOver - Boolean indicating if a drag is over the window
 */
export const useFolderDrop = (onDrop: (paths: string[]) => void | Promise<void>) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlistenWindow: (() => void) | null = null;
    let unlistenWebview: (() => void) | null = null;
    let domTeardown: (() => void) | null = null;

    const setupListener = async () => {
      // Listen on WebviewWindow
      unlistenWindow = await currentWindow.onDragDropEvent(async (event) => {
        // eslint-disable-next-line no-console
        console.debug("[dnd] window drag-drop event", event.payload?.type, event.payload);
        if (event.payload.type === "drop" && "paths" in event.payload) {
          const paths = event.payload.paths || [];
          if (paths.length > 0) {
            try {
              await onDrop(paths);
            } catch (error) {
              console.error("Error handling dropped items:", error);
            }
          }
          setIsDraggingOver(false);
        } else if (event.payload.type === "enter") {
          setIsDraggingOver(true);
        } else if (event.payload.type === "leave") {
          setIsDraggingOver(false);
        }
      });

      // Also listen directly on Webview (some environments dispatch here)
      const currentWebview = getCurrentWebview();
      unlistenWebview = await currentWebview.onDragDropEvent(async (event) => {
        // eslint-disable-next-line no-console
        console.debug("[dnd] webview drag-drop event", event.payload?.type, event.payload);
        if (event.payload.type === "drop" && "paths" in event.payload) {
          const paths = event.payload.paths || [];
          if (paths.length > 0) {
            try {
              await onDrop(paths);
            } catch (error) {
              console.error("Error handling dropped items:", error);
            }
          }
          setIsDraggingOver(false);
        } else if (event.payload.type === "enter") {
          setIsDraggingOver(true);
        } else if (event.payload.type === "leave") {
          setIsDraggingOver(false);
        }
      });

      // DOM fallback to prevent default navigation and show overlay if needed
      const onDomDragOver = (e: DragEvent) => {
        e.preventDefault();
      };
      const onDomDrop = (e: DragEvent) => {
        e.preventDefault();
      };
      const onDomEnter = (e: DragEvent) => {
        e.preventDefault();
        setIsDraggingOver(true);
      };
      const onDomLeave = (e: DragEvent) => {
        e.preventDefault();
        setIsDraggingOver(false);
      };
      window.addEventListener("dragover", onDomDragOver);
      window.addEventListener("drop", onDomDrop);
      window.addEventListener("dragenter", onDomEnter);
      window.addEventListener("dragleave", onDomLeave);
      domTeardown = () => {
        window.removeEventListener("dragover", onDomDragOver);
        window.removeEventListener("drop", onDomDrop);
        window.removeEventListener("dragenter", onDomEnter);
        window.removeEventListener("dragleave", onDomLeave);
      };
    };

    setupListener();

    return () => {
      if (unlistenWindow) unlistenWindow();
      if (unlistenWebview) unlistenWebview();
      if (domTeardown) domTeardown();
    };
  }, [onDrop]);

  return { isDraggingOver };
};

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/**
 * Hook to handle drag-and-drop from OS into the application
 * @param onDrop - Callback when files/folders are dropped (array of paths)
 * @returns isDraggingOver - Boolean indicating if a drag is over the window
 */
export const useFileSystemFolderDrop = (onDrop: (paths: string[]) => void | Promise<void>) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlistenWindow: (() => void) | null = null;
    let unlistenWebview: (() => void) | null = null;
    let domTeardown: (() => void) | null = null;

    const setupListener = async () => {
      unlistenWindow = await currentWindow.onDragDropEvent(async (event) => {
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

      const currentWebview = getCurrentWebview();
      unlistenWebview = await currentWebview.onDragDropEvent(async (event) => {
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

      const onDomDragOver = (event: DragEvent) => {
        event.preventDefault();
      };
      const onDomDrop = (event: DragEvent) => {
        event.preventDefault();
      };
      const onDomEnter = (event: DragEvent) => {
        event.preventDefault();
        setIsDraggingOver(true);
      };
      const onDomLeave = (event: DragEvent) => {
        event.preventDefault();
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

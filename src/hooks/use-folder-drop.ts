import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/**
 * Hook to handle folder drag-and-drop from OS into the application
 * @param onFolderDrop - Callback when a folder is dropped
 * @returns isDraggingOver - Boolean indicating if a folder is being dragged over the window
 */
export const useFolderDrop = (onFolderDrop: (path: string) => void | Promise<void>) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      unlisten = await currentWindow.onDragDropEvent(async (event) => {
        if (event.payload.type === "drop" && "paths" in event.payload) {
          const paths = event.payload.paths;

          if (paths && paths.length > 0) {
            try {
              await onFolderDrop(paths[0]);
            } catch (error) {
              console.error("Error handling dropped folder:", error);
            }
          }
          setIsDraggingOver(false);
        } else if (event.payload.type === "enter") {
          setIsDraggingOver(true);
        } else if (event.payload.type === "leave") {
          setIsDraggingOver(false);
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [onFolderDrop]);

  return { isDraggingOver };
};

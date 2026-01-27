import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { moveFile } from "@/features/file-system/controllers/platform";
import type { FileEntry } from "@/features/file-system/types/app";

interface DragState {
  isDragging: boolean;
  draggedItem: { path: string; name: string; isDir: boolean } | null;
  dragOverPath: string | null;
  dragOverIsDir: boolean;
  mousePosition: { x: number; y: number };
}

const initialDragState: DragState = {
  isDragging: false,
  draggedItem: null,
  dragOverPath: null,
  dragOverIsDir: false,
  mousePosition: { x: 0, y: 0 },
};

export function useDragDrop(
  rootFolderPath: string | undefined,
  onFileMove?: (oldPath: string, newPath: string) => void,
) {
  const [dragState, setDragState] = useState<DragState>(initialDragState);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (dragState.isDragging && !dragPreviewRef.current) {
      const preview = document.createElement("div");
      preview.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 9999;
        opacity: 0.95;
        padding: 6px 12px;
        background-color: var(--color-primary-bg);
        border: 2px solid var(--color-accent);
        border-radius: 6px;
        font-size: 12px;
        font-family: monospace;
        color: var(--color-text);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      `;
      preview.textContent = dragState.draggedItem?.name || "";
      document.body.appendChild(preview);
      dragPreviewRef.current = preview;
    }

    return () => {
      if (dragPreviewRef.current) {
        document.body.removeChild(dragPreviewRef.current);
        dragPreviewRef.current = null;
      }
    };
  }, [dragState.isDragging, dragState.draggedItem?.name]);

  useEffect(() => {
    if (dragPreviewRef.current) {
      dragPreviewRef.current.style.left = `${dragState.mousePosition.x + 10}px`;
      dragPreviewRef.current.style.top = `${dragState.mousePosition.y - 10}px`;
    }
  }, [dragState.mousePosition]);

  useEffect(() => {
    if (!dragState.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragState((prev) => ({
        ...prev,
        mousePosition: { x: e.clientX, y: e.clientY },
      }));

      const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
      const fileTreeItem = elementUnder?.closest("[data-file-path]");
      const fileTreeContainer = elementUnder?.closest(".file-tree-container");

      if (fileTreeItem) {
        const path = fileTreeItem.getAttribute("data-file-path");
        const isDir = fileTreeItem.getAttribute("data-is-dir") === "true";

        if (path && path !== dragState.draggedItem?.path) {
          const separator = dragState.draggedItem?.path.includes("\\") ? "\\" : "/";
          const isDropIntoSelf =
            dragState.draggedItem?.isDir && path.startsWith(dragState.draggedItem.path + separator);

          setDragState((prev) => ({
            ...prev,
            dragOverPath: isDropIntoSelf ? null : path,
            dragOverIsDir: isDropIntoSelf ? false : isDir,
          }));
        } else {
          setDragState((prev) => ({
            ...prev,
            dragOverPath: null,
            dragOverIsDir: false,
          }));
        }
      } else if (fileTreeContainer) {
        setDragState((prev) => ({
          ...prev,
          dragOverPath: "__ROOT__",
          dragOverIsDir: true,
        }));
      } else {
        setDragState((prev) => ({
          ...prev,
          dragOverPath: null,
          dragOverIsDir: false,
        }));
      }
    };

    const handleMouseUp = async (e: MouseEvent) => {
      // Check if dropping on a pane container (outside file tree)
      const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
      const isOverPane = elementUnder?.closest("[data-pane-container]") !== null;
      const isOverFileTree = elementUnder?.closest(".file-tree-container") !== null;

      // If dropping on a pane (not in file tree), dispatch event for pane to handle
      if (isOverPane && !isOverFileTree && dragState.draggedItem && !dragState.draggedItem.isDir) {
        window.dispatchEvent(
          new CustomEvent("file-tree-drop-on-pane", {
            detail: {
              path: dragState.draggedItem.path,
              name: dragState.draggedItem.name,
              isDir: dragState.draggedItem.isDir,
              x: e.clientX,
              y: e.clientY,
            },
          }),
        );
        setDragState(initialDragState);
        return;
      }

      if (dragState.dragOverPath && dragState.draggedItem) {
        const { path: sourcePath, name: sourceName } = dragState.draggedItem;
        let targetPath = dragState.dragOverPath;

        if (targetPath === "__ROOT__") {
          targetPath = rootFolderPath || "";
          if (!targetPath) {
            setDragState(initialDragState);
            return;
          }
        }

        const pathSeparator = sourcePath.includes("\\") ? "\\" : "/";
        if (!dragState.dragOverIsDir && targetPath !== "__ROOT__") {
          const pathParts = targetPath.split(pathSeparator);
          pathParts.pop();
          targetPath = pathParts.join(pathSeparator) || rootFolderPath || "";
        }

        const newPath = targetPath + pathSeparator + sourceName;

        try {
          await moveFile(sourcePath, newPath);
          onFileMove?.(sourcePath, newPath);
        } catch (error) {
          console.error("Failed to move file:", error);
          alert(`Failed to move ${sourceName}: ${error}`);
        }
      }

      setDragState(initialDragState);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mouseleave", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mouseleave", handleMouseUp);
    };
  }, [dragState, onFileMove, rootFolderPath]);

  const startDrag = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();

    setDragState({
      isDragging: true,
      draggedItem: { path: file.path, name: file.name, isDir: file.isDir },
      dragOverPath: null,
      dragOverIsDir: false,
      mousePosition: { x: e.clientX, y: e.clientY },
    });

    // Store drag data globally for pane containers to access
    window.__fileDragData = {
      path: file.path,
      name: file.name,
      isDir: file.isDir,
    };
  }, []);

  // Clean up global drag data on drag end
  useEffect(() => {
    if (!dragState.isDragging) {
      delete window.__fileDragData;
    }
  }, [dragState.isDragging]);

  return { dragState, startDrag };
}

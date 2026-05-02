import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { moveFile } from "@/features/file-system/controllers/platform";
import type { FileEntry } from "@/features/file-system/types/app";
import { dispatchSidebarResourceDropOnAI } from "@/features/sidebar-drag/sidebar-resource-drag";
import {
  setInternalTabDragHover,
  setInternalTabDragHoverTarget,
} from "@/features/tabs/utils/internal-tab-drag";
import { getDirName, getPathSeparator, joinPath } from "@/utils/path-helpers";

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

export function useFileExplorerDragDrop(
  rootFolderPath: string | undefined,
  onFileMove?: (oldPath: string, newPath: string) => void,
  onAutoExpandDirectory?: (path: string) => void,
) {
  const [dragState, setDragState] = useState<DragState>(initialDragState);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const autoExpandRef = useRef<{
    path: string;
    timeoutId: number;
  } | null>(null);

  const clearAutoExpand = useCallback(() => {
    if (!autoExpandRef.current) return;
    window.clearTimeout(autoExpandRef.current.timeoutId);
    autoExpandRef.current = null;
  }, []);

  const clearEditorDropHover = useCallback(() => {
    setInternalTabDragHoverTarget({ paneId: null, zone: null });
  }, []);

  const scheduleAutoExpand = useCallback(
    (path: string, isDir: boolean) => {
      if (!isDir || path === "__ROOT__" || !onAutoExpandDirectory) {
        clearAutoExpand();
        return;
      }

      if (autoExpandRef.current?.path === path) {
        return;
      }

      clearAutoExpand();
      autoExpandRef.current = {
        path,
        timeoutId: window.setTimeout(() => {
          onAutoExpandDirectory(path);
          autoExpandRef.current = null;
        }, 550),
      };
    },
    [clearAutoExpand, onAutoExpandDirectory],
  );

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
      const aiContextDropTarget = elementUnder?.closest("[data-ai-context-drop-target]");
      const editorDropTarget =
        elementUnder?.closest("[data-pane-container]") ||
        elementUnder?.closest("[data-tab-bar-pane-id]");

      if (fileTreeItem) {
        clearEditorDropHover();
        const path = fileTreeItem.getAttribute("data-file-path");
        const isDir = fileTreeItem.getAttribute("data-is-dir") === "true";
        const draggedItem = dragState.draggedItem;

        if (path && draggedItem && path !== draggedItem.path) {
          const separator = getPathSeparator(draggedItem.path);
          const isDropIntoSelf = draggedItem.isDir && path.startsWith(draggedItem.path + separator);
          const nextDragOverPath = isDropIntoSelf ? null : path;
          const nextDragOverIsDir = isDropIntoSelf ? false : isDir;

          setDragState((prev) => ({
            ...prev,
            dragOverPath: nextDragOverPath,
            dragOverIsDir: nextDragOverIsDir,
          }));
          if (nextDragOverPath) {
            scheduleAutoExpand(nextDragOverPath, nextDragOverIsDir);
          } else {
            clearAutoExpand();
          }
        } else {
          setDragState((prev) => ({
            ...prev,
            dragOverPath: null,
            dragOverIsDir: false,
          }));
          clearAutoExpand();
        }
      } else if (fileTreeContainer) {
        clearEditorDropHover();
        setDragState((prev) => ({
          ...prev,
          dragOverPath: "__ROOT__",
          dragOverIsDir: true,
        }));
        clearAutoExpand();
      } else if (aiContextDropTarget && dragState.draggedItem) {
        clearEditorDropHover();
        setDragState((prev) => ({
          ...prev,
          dragOverPath: null,
          dragOverIsDir: false,
        }));
        clearAutoExpand();
      } else if (editorDropTarget && dragState.draggedItem && !dragState.draggedItem.isDir) {
        setInternalTabDragHover({ x: e.clientX, y: e.clientY });
        setDragState((prev) => ({
          ...prev,
          dragOverPath: null,
          dragOverIsDir: false,
        }));
        clearAutoExpand();
      } else {
        clearEditorDropHover();
        setDragState((prev) => ({
          ...prev,
          dragOverPath: null,
          dragOverIsDir: false,
        }));
        clearAutoExpand();
      }
    };

    const handleMouseUp = async (e: MouseEvent) => {
      // Check if dropping on a pane container (outside file tree)
      const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
      const isOverPane = elementUnder?.closest("[data-pane-container]") !== null;
      const isOverFileTree = elementUnder?.closest(".file-tree-container") !== null;
      const isOverAIContextDropTarget =
        elementUnder?.closest("[data-ai-context-drop-target]") !== null;

      if (isOverAIContextDropTarget && dragState.draggedItem) {
        dispatchSidebarResourceDropOnAI({
          type: "file",
          path: dragState.draggedItem.path,
          name: dragState.draggedItem.name,
          isDir: dragState.draggedItem.isDir,
        });
        setDragState(initialDragState);
        clearAutoExpand();
        clearEditorDropHover();
        return;
      }

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
        clearAutoExpand();
        clearEditorDropHover();
        return;
      }

      if (dragState.dragOverPath && dragState.draggedItem) {
        const { path: sourcePath, name: sourceName } = dragState.draggedItem;
        let targetPath = dragState.dragOverPath;

        if (targetPath === "__ROOT__") {
          targetPath = rootFolderPath || "";
          if (!targetPath) {
            setDragState(initialDragState);
            clearEditorDropHover();
            return;
          }
        }

        if (!dragState.dragOverIsDir && targetPath !== "__ROOT__") {
          targetPath = getDirName(targetPath) || rootFolderPath || "";
        }

        const newPath = joinPath(targetPath, sourceName);

        try {
          await moveFile(sourcePath, newPath);
          onFileMove?.(sourcePath, newPath);
        } catch (error) {
          console.error("Failed to move file:", error);
          alert(`Failed to move ${sourceName}: ${error}`);
        }
      }

      setDragState(initialDragState);
      clearAutoExpand();
      clearEditorDropHover();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mouseleave", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mouseleave", handleMouseUp);
      clearAutoExpand();
      clearEditorDropHover();
    };
  }, [
    clearAutoExpand,
    clearEditorDropHover,
    dragState,
    onFileMove,
    rootFolderPath,
    scheduleAutoExpand,
  ]);

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

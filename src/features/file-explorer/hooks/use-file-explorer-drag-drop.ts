import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { startNativeFileDrag } from "@/features/file-explorer/utils/start-native-file-drag";
import { dispatchSidebarResourceDropOnAI } from "@/features/sidebar/utils/sidebar-resource-drag";
import {
  setInternalTabDragHover,
  setInternalTabDragHoverTarget,
} from "@/features/tabs/utils/internal-tab-drag";
import { getDirName, getPathSeparator, joinPath } from "@/utils/path-helpers";
import { IS_MAC } from "@/utils/platform";
import { emitAppEvent } from "@/utils/app-events";

interface DragState {
  isDragging: boolean;
  draggedItem: { path: string; name: string; isDir: boolean } | null;
  dragOverPath: string | null;
  dragOverIsDir: boolean;
}

const initialDragState: DragState = {
  isDragging: false,
  draggedItem: null,
  dragOverPath: null,
  dragOverIsDir: false,
};

type FileMoveHandler = (oldPath: string, newPath: string) => void | Promise<void>;

export async function executeFileExplorerMove(
  oldPath: string,
  newPath: string,
  onFileMove?: FileMoveHandler,
) {
  if (!onFileMove) {
    throw new Error("File move handler is unavailable.");
  }

  await onFileMove(oldPath, newPath);
}

export function useFileExplorerDragDrop(
  rootFolderPath: string | undefined,
  onFileMove?: FileMoveHandler,
  onAutoExpandDirectory?: (path: string) => void,
  onMoveError?: (message: string) => void,
) {
  const [dragState, setDragState] = useState<DragState>(initialDragState);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  // The pointer moves the preview directly; keeping it in state re-rendered the whole tree on
  // every mouse move of a drag.
  const pointerRef = useRef({ x: 0, y: 0 });
  const placeDragPreview = useCallback(() => {
    const preview = dragPreviewRef.current;
    if (!preview) return;
    preview.style.left = `${pointerRef.current.x + 10}px`;
    preview.style.top = `${pointerRef.current.y - 10}px`;
  }, []);
  const setDragOver = useCallback((path: string | null, isDir: boolean) => {
    setDragState((prev) =>
      prev.dragOverPath === path && prev.dragOverIsDir === isDir
        ? prev
        : { ...prev, dragOverPath: path, dragOverIsDir: isDir },
    );
  }, []);
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
        background-color: var(--background);
        border: 2px solid var(--primary);
        border-radius: var(--radius-lg);
        font-size: var(--ui-text-sm);
        font-family: var(--app-font-family);
        color: var(--foreground);
        box-shadow: var(--shadow-popover);
      `;
      preview.textContent = dragState.draggedItem?.name || "";
      document.body.appendChild(preview);
      dragPreviewRef.current = preview;
      placeDragPreview();
    }

    return () => {
      if (dragPreviewRef.current) {
        document.body.removeChild(dragPreviewRef.current);
        dragPreviewRef.current = null;
      }
    };
  }, [dragState.isDragging, dragState.draggedItem?.name, placeDragPreview]);

  useEffect(() => {
    if (!dragState.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      placeDragPreview();

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

          setDragOver(nextDragOverPath, nextDragOverIsDir);
          if (nextDragOverPath) {
            scheduleAutoExpand(nextDragOverPath, nextDragOverIsDir);
          } else {
            clearAutoExpand();
          }
        } else {
          setDragOver(null, false);
          clearAutoExpand();
        }
      } else if (fileTreeContainer) {
        clearEditorDropHover();
        setDragOver("__ROOT__", true);
        clearAutoExpand();
      } else if (aiContextDropTarget && dragState.draggedItem) {
        clearEditorDropHover();
        setDragOver(null, false);
        clearAutoExpand();
      } else if (editorDropTarget && dragState.draggedItem && !dragState.draggedItem.isDir) {
        setInternalTabDragHover({ x: e.clientX, y: e.clientY });
        setDragOver(null, false);
        clearAutoExpand();
      } else {
        clearEditorDropHover();
        setDragOver(null, false);
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
        emitAppEvent("file-tree-drop-on-pane", {
          path: dragState.draggedItem.path,
          name: dragState.draggedItem.name,
          isDir: dragState.draggedItem.isDir,
          x: e.clientX,
          y: e.clientY,
        });
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
          await executeFileExplorerMove(sourcePath, newPath, onFileMove);
        } catch (error) {
          console.error("Failed to move file:", error);
          const message = error instanceof Error ? error.message : String(error);
          onMoveError?.(`Failed to move ${sourceName}: ${message}`);
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
    onMoveError,
    placeDragPreview,
    rootFolderPath,
    scheduleAutoExpand,
    setDragOver,
  ]);

  const startDrag = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();

    if (IS_MAC && e.altKey) {
      void startNativeFileDrag(file.path, file.name).catch((error) => {
        console.error("Failed to start native file drag:", error);
      });
      return;
    }

    setDragState({
      isDragging: true,
      draggedItem: { path: file.path, name: file.name, isDir: file.isDir },
      dragOverPath: null,
      dragOverIsDir: false,
    });
    pointerRef.current = { x: e.clientX, y: e.clientY };

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

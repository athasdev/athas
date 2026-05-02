import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import {
  clearInternalTabDragData,
  getInternalTabDragData,
} from "@/features/tabs/utils/internal-tab-drag";
import { useUIState } from "@/features/window/stores/ui-state-store";

function resolveClientPoint(position: { x: number; y: number }) {
  const rawPoint = { x: position.x, y: position.y };
  const scaledPoint = {
    x: position.x / window.devicePixelRatio,
    y: position.y / window.devicePixelRatio,
  };

  const rawElement = document.elementFromPoint(rawPoint.x, rawPoint.y);
  if (rawElement) {
    return { point: rawPoint, element: rawElement };
  }

  const scaledElement = document.elementFromPoint(scaledPoint.x, scaledPoint.y);
  return { point: scaledPoint, element: scaledElement };
}

function routeInternalTabDrop(position: { x: number; y: number }) {
  const tabData = getInternalTabDragData();
  if (!tabData) return false;

  const { element } = resolveClientPoint(position);
  if (!element) return false;

  const paneActions = usePaneStore.getState().actions;
  const bufferActions = useBufferStore.getState().actions;
  const uiState = useUIState.getState();

  const tabBar = element.closest<HTMLElement>("[data-tab-bar-pane-id]");
  const paneContainer = element.closest<HTMLElement>("[data-pane-id]");
  const bottomPaneTarget = element.closest<HTMLElement>("[data-bottom-pane-drop-target]");

  const targetPaneId =
    tabBar?.dataset.tabBarPaneId ||
    paneContainer?.dataset.paneId ||
    (bottomPaneTarget ? BOTTOM_PANE_ID : null);

  if (!targetPaneId) return false;

  if (tabData.source === "terminal-panel" && tabData.terminalId) {
    paneActions.setActivePane(targetPaneId);
    bufferActions.openTerminalBuffer({
      sessionId: tabData.terminalId,
      name: tabData.name,
      command: tabData.initialCommand,
      workingDirectory: tabData.currentDirectory,
      remoteConnectionId: tabData.remoteConnectionId,
    });
    window.dispatchEvent(
      new CustomEvent("terminal-detach-to-buffer", {
        detail: { terminalId: tabData.terminalId },
      }),
    );
  } else if (tabData.bufferId && tabData.paneId && tabData.paneId !== targetPaneId) {
    paneActions.moveBufferToPane(tabData.bufferId, tabData.paneId, targetPaneId);
  } else {
    return false;
  }

  if (targetPaneId === BOTTOM_PANE_ID) {
    uiState.setBottomPaneActiveTab("buffers");
    uiState.setIsBottomPaneVisible(true);
  }

  clearInternalTabDragData();

  return true;
}

function isExternalFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;

  return Array.from(types).includes("Files");
}

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
        if (getInternalTabDragData()) {
          if (
            event.payload.type === "drop" &&
            "position" in event.payload &&
            routeInternalTabDrop(event.payload.position)
          ) {
            setIsDraggingOver(false);
            return;
          }
          if (event.payload.type === "leave" || event.payload.type === "drop") {
            setIsDraggingOver(false);
          }
          return;
        }
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
        if (getInternalTabDragData()) {
          if (
            event.payload.type === "drop" &&
            "position" in event.payload &&
            routeInternalTabDrop(event.payload.position)
          ) {
            setIsDraggingOver(false);
            return;
          }
          if (event.payload.type === "leave" || event.payload.type === "drop") {
            setIsDraggingOver(false);
          }
          return;
        }
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
        if (getInternalTabDragData()) return;
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
      };
      const onDomDrop = (event: DragEvent) => {
        if (getInternalTabDragData()) {
          setIsDraggingOver(false);
          return;
        }
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        setIsDraggingOver(false);
      };
      const onDomEnter = (event: DragEvent) => {
        if (getInternalTabDragData()) return;
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        setIsDraggingOver(true);
      };
      const onDomLeave = (event: DragEvent) => {
        if (getInternalTabDragData()) {
          setIsDraggingOver(false);
          return;
        }
        if (!isExternalFileDrag(event)) return;
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
